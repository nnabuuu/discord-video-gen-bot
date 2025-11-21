import { Injectable } from '@nestjs/common';
import { Client, TextChannel, EmbedBuilder, Colors } from 'discord.js';
import { logger } from '../common/logger';
import { RequestTrackingService } from '../database/request-tracking.service';
import { VeoService } from '../veo/veo.service';
import { StorageService } from '../storage/storage.service';
import { VideoAttachmentService } from './video-attachment.service';
import { VideoRequestRow, VideoRequestStatus } from '../database/database.types';

@Injectable()
export class TaskResumeService {
  private discordClient!: Client;

  constructor(
    private readonly requestTrackingService: RequestTrackingService,
    private readonly veoService: VeoService,
    private readonly storageService: StorageService,
    private readonly videoAttachmentService: VideoAttachmentService,
  ) {}

  setDiscordClient(client: Client): void {
    this.discordClient = client;
  }

  async resumeIncompleteTasks(): Promise<void> {
    const startTime = Date.now();
    logger.info('Starting resume process for interrupted requests');

    try {
      // Fetch incomplete requests
      const requests = await this.requestTrackingService.getIncompleteRequests(24);

      if (requests.length === 0) {
        logger.info('No incomplete requests to resume');
        return;
      }

      const pendingCount = requests.filter((r) => r.status === VideoRequestStatus.PENDING).length;
      const generatingCount = requests.filter(
        (r) => r.status === VideoRequestStatus.GENERATING,
      ).length;

      logger.info(
        {
          total: requests.length,
          pending: pendingCount,
          generating: generatingCount,
        },
        'Found incomplete requests',
      );

      // Process with concurrency limit of 3
      const results = {
        completed: 0,
        failed: 0,
        timeout: 0,
      };

      // Process in batches of 3
      for (let i = 0; i < requests.length; i += 3) {
        const batch = requests.slice(i, i + 3);

        const batchResults = await Promise.allSettled(
          batch.map(async (request) => {
            const requestStartTime = Date.now();

            try {
              // Check if pending request is too old (>24 hours)
              if (request.status === VideoRequestStatus.PENDING) {
                const ageHours =
                  (Date.now() - new Date(request.created_at).getTime()) / (1000 * 60 * 60);

                if (ageHours > 24) {
                  logger.warn(
                    {
                      requestId: request.id,
                      ageHours: ageHours.toFixed(2),
                    },
                    'Marking old pending request as expired',
                  );
                  await this.requestTrackingService.setTimeout(
                    request.id,
                    'Request expired (>24 hours old)',
                  );
                  results.timeout++;
                  return;
                }
              }

              // Timeout protection: 10 minutes per request
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Request timeout')), 10 * 60 * 1000),
              );

              const resumePromise =
                request.status === VideoRequestStatus.PENDING
                  ? this.resumePendingRequest(request)
                  : this.resumeGeneratingRequest(request);

              await Promise.race([resumePromise, timeoutPromise]);

              const duration = Date.now() - requestStartTime;
              logger.info(
                {
                  requestId: request.id,
                  durationMs: duration,
                },
                'Request resumed successfully',
              );
              results.completed++;
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);

              if (errorMessage.includes('timeout')) {
                logger.warn({ requestId: request.id }, 'Request resume timeout');
                results.timeout++;
                await this.requestTrackingService.setTimeout(request.id);
              } else {
                logger.error({ requestId: request.id, error: errorMessage }, 'Request resume failed');
                results.failed++;
              }
            }
          }),
        );

        // Log batch progress
        logger.info(
          {
            processed: i + batch.length,
            total: requests.length,
          },
          'Batch processed',
        );
      }

      const totalDuration = Date.now() - startTime;
      logger.info(
        {
          ...results,
          total: requests.length,
          durationMs: totalDuration,
        },
        'Resume process completed',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Resume process failed');
    }
  }

  async resumePendingRequest(request: VideoRequestRow): Promise<void> {
    const requestId = request.id;
    logger.info(
      {
        requestId,
        userId: request.user_id,
        prompt: request.prompt.substring(0, 50),
      },
      'Resuming pending request',
    );

    try {
      // Build output prefix for GCS
      const prefix = this.storageService.buildOutputPrefix(
        request.guild_id,
        request.channel_id,
        request.user_id,
        requestId,
      );
      const outputUri = this.storageService.buildOutputUri(prefix);

      // Start video generation
      const operationName = await this.veoService.startGeneration(
        {
          prompt: request.prompt,
          durationSeconds: request.duration_seconds ?? 8,
          aspectRatio: (request.aspect_ratio === '16:9' || request.aspect_ratio === '9:16')
            ? request.aspect_ratio
            : '16:9',
          resolution: request.resolution ?? '720p',
          generateAudio: request.generate_audio ?? true,
          sampleCount: 1,
        },
        outputUri,
      );

      // Update database status to generating
      await this.requestTrackingService.setGenerating(requestId, operationName, prefix);

      logger.info({ requestId, operationName }, 'Pending request generation started');

      // Now poll for completion (delegate to resumeGeneratingRequest logic)
      await this.pollAndComplete(requestId, operationName, prefix, request);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ requestId, error: errorMessage }, 'Failed to resume pending request');

      await this.requestTrackingService.setFailed(requestId, errorMessage);
    }
  }

  async resumeGeneratingRequest(request: VideoRequestRow): Promise<void> {
    const requestId = request.id;
    const operationName = request.operation_name;
    const prefix = request.gcs_prefix;

    if (!operationName) {
      logger.warn({ requestId }, 'Generating request missing operation_name');
      await this.requestTrackingService.setFailed(requestId, 'Missing operation_name');
      return;
    }

    if (!prefix) {
      logger.warn({ requestId }, 'Generating request missing gcs_prefix');
      await this.requestTrackingService.setFailed(requestId, 'Missing gcs_prefix');
      return;
    }

    logger.info(
      {
        requestId,
        userId: request.user_id,
        operationName,
      },
      'Resuming generating request',
    );

    try {
      await this.pollAndComplete(requestId, operationName, prefix, request);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if operation expired/not found
      if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        logger.warn({ requestId, operationName }, 'Vertex AI operation expired');
        await this.requestTrackingService.setTimeout(requestId);
      } else {
        logger.error({ requestId, error: errorMessage }, 'Failed to resume generating request');
        await this.requestTrackingService.setFailed(requestId, errorMessage);
      }
    }
  }

  private async pollAndComplete(
    requestId: string,
    operationName: string,
    prefix: string,
    request: VideoRequestRow,
  ): Promise<void> {
    // Poll for operation completion (no progress callback for resumed tasks)
    await this.veoService.pollOperation(operationName, prefix);

    // List generated files
    const files = await this.storageService.listFiles(prefix);

    if (files.length === 0) {
      await this.requestTrackingService.setFailed(
        requestId,
        'No video files found after generation',
      );
      logger.warn({ requestId }, 'No video files found');
      return;
    }

    // Make files public and build URLs
    const publicUrls: string[] = [];
    for (const fileName of files) {
      await this.storageService.makePublic(fileName);
      publicUrls.push(this.storageService.publicUrl(fileName));
    }

    // Update database
    await this.requestTrackingService.setCompleted(requestId, publicUrls);

    logger.info({ requestId, videoCount: publicUrls.length }, 'Video generation completed');

    // Build completion embed
    const completionEmbed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setDescription(`**${request.prompt}**`)
      .addFields(
        { name: 'Duration', value: `${request.duration_seconds ?? 'N/A'}s`, inline: true },
        { name: 'Aspect Ratio', value: request.aspect_ratio, inline: true },
        { name: 'Resolution', value: request.resolution ?? 'N/A', inline: true },
      )
      .setTimestamp();

    // Send notification to channel
    const sent = await this.sendChannelMessage(
      request.channel_id,
      request.user_id,
      completionEmbed,
      files[0], // First video file
    );

    if (!sent) {
      logger.warn(
        {
          requestId,
          channelId: request.channel_id,
          guildId: request.guild_id,
          videoUrls: publicUrls,
        },
        'Unable to notify user - channel inaccessible. Video generated successfully.',
      );
    }
  }

  private async sendChannelMessage(
    channelId: string,
    userId: string,
    embed: EmbedBuilder,
    videoFileName?: string,
  ): Promise<boolean> {
    if (!this.discordClient) {
      logger.error('Discord client not initialized');
      return false;
    }

    try {
      // Fetch channel
      const channel = await this.discordClient.channels.fetch(channelId);

      if (!channel) {
        logger.warn({ channelId }, 'Channel not found');
        return false;
      }

      if (!channel.isTextBased()) {
        logger.warn({ channelId }, 'Channel is not text-based');
        return false;
      }

      const textChannel = channel as TextChannel;

      // Add footer indicating resume
      embed.setFooter({ text: '✓ Resumed after bot restart' });

      // Prepare message content with user mention
      const content = `<@${userId}>`;

      // Attempt to attach video if provided
      if (videoFileName) {
        try {
          const result = await this.videoAttachmentService.attachVideoOrFallback(
            videoFileName,
            {
              editReply: async (options: any) => {
                await textChannel.send({
                  content,
                  ...options,
                });
              },
            } as any,
            embed,
          );

          if (result.method === 'url') {
            // Fallback: send URL instead
            await textChannel.send({
              content: `${content}\n${result.url}`,
              embeds: [embed],
            });
          }

          logger.info({ channelId, userId, method: result.method }, 'Sent resumed task message');
          return true;
        } catch (attachError) {
          logger.warn({ channelId, error: attachError }, 'Failed to attach video, sending URL');
          // Send just the embed
          await textChannel.send({
            content,
            embeds: [embed],
          });
          return true;
        }
      } else {
        // No video - just send embed
        await textChannel.send({
          content,
          embeds: [embed],
        });
        logger.info({ channelId, userId }, 'Sent resumed task message (no video)');
        return true;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Log at appropriate level based on error type
      if (errorMessage.includes('Missing Access') || errorMessage.includes('permissions')) {
        logger.warn(
          { channelId, userId, error: errorMessage },
          'Missing permissions to send channel message',
        );
      } else {
        logger.error({ channelId, userId, error: errorMessage }, 'Failed to send channel message');
      }

      return false;
    }
  }
}
