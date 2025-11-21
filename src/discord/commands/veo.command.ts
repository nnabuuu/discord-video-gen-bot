import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { logger } from '../../common/logger';
import { VeoCommandOptionsSchema, validatePromptContent } from '../../common/dto';
import { VeoService } from '../../veo/veo.service';
import { StorageService } from '../../storage/storage.service';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { VideoAttachmentService } from '../video-attachment.service';
import { RequestTrackingService } from '../../database/request-tracking.service';
import { RequestType } from '../../database/database.types';
import { randomUUID } from 'crypto';

export class VeoCommand {
  public static readonly data = new SlashCommandBuilder()
    .setName('veo')
    .setDescription('Generate a video using Google Cloud Vertex AI Veo 3.1')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Text description of the video to generate (min 5 chars)')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('length')
        .setDescription('Video duration in seconds')
        .addChoices(
          { name: '4 seconds', value: 4 },
          { name: '6 seconds', value: 6 },
          { name: '8 seconds', value: 8 },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('ratio')
        .setDescription('Aspect ratio')
        .addChoices(
          { name: '16:9 (landscape)', value: '16:9' },
          { name: '9:16 (portrait)', value: '9:16' },
        ),
    )
    .addBooleanOption((option) =>
      option.setName('hd').setDescription('Generate in HD (1080p) vs SD (720p)'),
    )
    .addBooleanOption((option) =>
      option.setName('audio').setDescription('Generate audio for the video'),
    );

  constructor(
    private readonly veoService: VeoService,
    private readonly storageService: StorageService,
    private readonly rateLimitService: RateLimitService,
    private readonly videoAttachmentService: VideoAttachmentService,
    private readonly requestTrackingService: RequestTrackingService,
  ) {}

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const guildId = interaction.guildId || 'dm';
    const channelId = interaction.channelId;

    // Channel whitelist check
    const allowedChannels = process.env.ALLOWED_CHANNEL_IDS?.split(',').map((id) => id.trim()) || [];

    if (allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
      await interaction.reply({
        content: '⛔ This command can only be used in authorized channels.',
        ephemeral: true,
      });
      logger.warn(
        { userId, channelId, guildId },
        'Command attempted in unauthorized channel',
      );
      return;
    }

    // Defer immediately to prevent Discord timeout
    await interaction.deferReply();

    let dbRequestId: string | null = null;

    try {
      // Parse and validate options
      const rawOptions = {
        prompt: interaction.options.getString('prompt', true),
        length: interaction.options.getInteger('length') ?? 4,
        ratio: interaction.options.getString('ratio') ?? '16:9',
        hd: interaction.options.getBoolean('hd') ?? false,
        audio: interaction.options.getBoolean('audio') ?? true,
      };

      const parseResult = VeoCommandOptionsSchema.safeParse(rawOptions);
      if (!parseResult.success) {
        await interaction.editReply(
          `❌ Invalid options: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        );
        return;
      }

      const options = parseResult.data;

      // Content safety validation
      const contentCheck = validatePromptContent(options.prompt);
      if (!contentCheck.valid) {
        await interaction.editReply(`❌ ${contentCheck.reason}`);
        return;
      }

      // Rate limit check
      const rateLimitResult = await this.rateLimitService.consume(userId, RequestType.VEO);
      if (!rateLimitResult.allowed) {
        const hours = Math.floor(rateLimitResult.waitSeconds! / 3600);
        const minutes = Math.floor((rateLimitResult.waitSeconds! % 3600) / 60);
        const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        await interaction.editReply(
          `⏱️ You've reached your daily limit of 5 videos. Please try again in ${timeStr}.`,
        );
        return;
      }

      const resolution = options.hd ? '1080p' : '720p';

      // Create request in database
      dbRequestId = await this.requestTrackingService.createRequest({
        user_id: userId,
        guild_id: guildId,
        channel_id: channelId,
        prompt: options.prompt,
        request_type: RequestType.VEO,
        duration_seconds: options.length as 4 | 6 | 8,
        aspect_ratio: options.ratio as '16:9' | '9:16',
        resolution: resolution as '720p' | '1080p',
        generate_audio: options.audio,
      });

      logger.info(
        {
          userId,
          guildId,
          channelId,
          requestId: dbRequestId,
          options,
        },
        'Processing /veo command',
      );

      // Build output URI
      const prefix = this.storageService.buildOutputPrefix(
        guildId,
        channelId,
        userId,
        dbRequestId,
      );
      const outputUri = this.storageService.buildOutputUri(prefix);

      // Start generation
      const operationName = await this.veoService.startGeneration(
        {
          prompt: options.prompt,
          durationSeconds: options.length as 4 | 6 | 8,
          aspectRatio: options.ratio as '16:9' | '9:16',
          resolution,
          generateAudio: options.audio,
          sampleCount: 1,
        },
        outputUri,
      );

      // Update request status to generating
      await this.requestTrackingService.setGenerating(dbRequestId, operationName, prefix);

      // Midjourney-style progress updates
      const progressEmbed = new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setDescription(`**${options.prompt}**`)
        .setFooter({ text: 'Waiting to start...' })
        .setTimestamp();

      await interaction.editReply({ embeds: [progressEmbed] });

      // Poll for completion with progress updates
      await this.veoService.pollOperation(operationName, prefix, async (progress) => {
        // Update progress in Discord (Midjourney style)
        const percentage = Math.round(progress * 100);
        const progressBar = this.createProgressBar(progress);

        progressEmbed
          .setFooter({ text: `${progressBar} ${percentage}% complete` })
          .setTimestamp();

        try {
          await interaction.editReply({ embeds: [progressEmbed] });
        } catch (error) {
          logger.warn({ error }, 'Failed to update progress message');
        }
      });

      // List generated files
      const files = await this.storageService.listFiles(prefix);

      if (files.length === 0) {
        // Update request status to failed
        await this.requestTrackingService.setFailed(
          dbRequestId,
          'No video files were found after generation',
        );

        await interaction.editReply(
          `❌ Generation completed but no video files were found. Operation: \`${operationName}\``,
        );
        return;
      }

      // Make files public and build URLs
      const publicUrls: string[] = [];
      for (const fileName of files) {
        await this.storageService.makePublic(fileName);
        publicUrls.push(this.storageService.publicUrl(fileName));
      }

      // Update request status to completed
      await this.requestTrackingService.setCompleted(dbRequestId, publicUrls);

      // Midjourney-style completion message
      const completionEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setDescription(`**${options.prompt}**`)
        .addFields(
          { name: 'Duration', value: `${options.length}s`, inline: true },
          { name: 'Aspect Ratio', value: options.ratio, inline: true },
          { name: 'Resolution', value: resolution, inline: true },
        )
        .setFooter({
          text: `Fast mode • ${rateLimitResult.remaining - 1}/5 remaining today`,
        })
        .setTimestamp();

      // Attach video directly to Discord message (or fallback to URL)
      const attachmentResult = await this.videoAttachmentService.attachVideoOrFallback(
        files[0],
        interaction,
        completionEmbed,
        dbRequestId,
      );

      // Handle fallback scenarios with warning messages
      if (attachmentResult.method === 'url') {
        let warningMessage = '';
        switch (attachmentResult.reason) {
          case 'size_exceeded':
            warningMessage = '⚠️ Video is too large for direct preview (>25MB). Click link to view.';
            break;
          case 'download_error':
            warningMessage = 'Video preview unavailable due to download error. View at URL.';
            break;
          case 'concurrency_timeout':
            warningMessage = 'High server load. View video at URL.';
            break;
          case 'discord_error':
            warningMessage = 'Video preview unavailable. View at URL.';
            break;
        }

        const videoLinks = publicUrls.map((url) => url).join('\n');
        await interaction.editReply({
          content: `${warningMessage}\n\n${videoLinks}`,
          embeds: [completionEmbed],
        });

        logger.info(
          {
            userId,
            requestId: dbRequestId,
            videoCount: publicUrls.length,
            remaining: rateLimitResult.remaining - 1,
            attachmentMethod: 'url',
            fallbackReason: attachmentResult.reason,
          },
          'Video generation completed (URL fallback)',
        );
      } else {
        logger.info(
          {
            userId,
            requestId: dbRequestId,
            videoCount: publicUrls.length,
            remaining: rateLimitResult.remaining - 1,
            attachmentMethod: 'attached',
          },
          'Video generation completed',
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unexpected error occurred';

      // Update request status to failed or timeout
      if (dbRequestId) {
        if (errorMessage.includes('timed out') || errorMessage.includes('timeout')) {
          await this.requestTrackingService.setTimeout(dbRequestId);
        } else {
          await this.requestTrackingService.setFailed(dbRequestId, errorMessage);
        }
      }

      logger.error(
        {
          error: error instanceof Error ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          } : error,
          userId,
          guildId,
          channelId,
          requestId: dbRequestId,
        },
        'Error executing /veo command',
      );

      if (interaction.deferred) {
        await interaction.editReply(
          `❌ Failed to generate video: ${errorMessage}\n\nPlease try again or contact support if the issue persists.`,
        );
      } else {
        await interaction.reply({
          content: `❌ Failed to generate video: ${errorMessage}`,
          ephemeral: true,
        });
      }
    }
  }

  private createProgressBar(progress: number): string {
    // Midjourney-style progress bar with blocks
    const blocks = 10;
    const filled = Math.round(progress * blocks);
    const empty = blocks - filled;

    const filledBar = '█'.repeat(filled);
    const emptyBar = '░'.repeat(empty);

    return `${filledBar}${emptyBar}`;
  }
}
