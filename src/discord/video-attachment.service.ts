import { Injectable } from '@nestjs/common';
import { ChatInputCommandInteraction, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { StorageService } from '../storage/storage.service';
import { Semaphore } from '../common/semaphore';
import { logger } from '../common/logger';

const DISCORD_MAX_FILE_SIZE = 26214400; // 25MB in bytes

export interface AttachmentResult {
  method: 'attached' | 'url';
  reason?: 'size_exceeded' | 'download_error' | 'concurrency_timeout' | 'discord_error';
  url?: string;
}

@Injectable()
export class VideoAttachmentService {
  private readonly downloadSemaphore: Semaphore;
  private readonly concurrencyLimit: number;

  constructor(private readonly storageService: StorageService) {
    this.concurrencyLimit = parseInt(process.env.MAX_CONCURRENT_ATTACHMENTS || '5', 10);
    this.downloadSemaphore = new Semaphore(this.concurrencyLimit);
  }

  async attachVideoOrFallback(
    objectName: string,
    interaction: ChatInputCommandInteraction,
    embed: EmbedBuilder,
    requestId?: string,
  ): Promise<AttachmentResult> {
    const startTime = Date.now();
    let acquireTime: number | null = null;
    let downloadTime: number | null = null;

    try {
      // Check file size before downloading
      logger.info({ objectName, requestId }, 'Checking video file size');
      const metadata = await this.storageService.getFileMetadata(objectName);

      if (metadata.size > DISCORD_MAX_FILE_SIZE) {
        const sizeMB = (metadata.size / 1024 / 1024).toFixed(2);
        logger.info(
          { objectName, requestId, sizeMB, maxSizeMB: 25 },
          'Video exceeds Discord size limit, falling back to URL',
        );
        return {
          method: 'url',
          reason: 'size_exceeded',
          url: this.storageService.publicUrl(objectName),
        };
      }

      // Log queue depth before acquiring
      const queueDepth = this.downloadSemaphore.getQueueDepth();
      const availablePermits = this.downloadSemaphore.getAvailablePermits();
      logger.info(
        { objectName, requestId, queueDepth, availablePermits },
        'Waiting for download slot',
      );

      // Acquire semaphore slot with timeout
      const acquireStart = Date.now();
      await this.downloadSemaphore.acquire(30000);
      acquireTime = Date.now() - acquireStart;

      logger.info({ objectName, requestId, waitDurationMs: acquireTime }, 'Acquired download slot');

      try {
        // Download file to buffer
        const downloadStart = Date.now();
        const buffer = await this.storageService.downloadToBuffer(objectName);
        downloadTime = Date.now() - downloadStart;

        logger.info(
          {
            objectName,
            requestId,
            fileSize: metadata.size,
            downloadDurationMs: downloadTime,
          },
          'Downloaded video file',
        );

        // Create attachment and send to Discord
        const filename = objectName.split('/').pop() || 'video.mp4';
        const attachment = new AttachmentBuilder(buffer, { name: filename });

        await interaction.editReply({
          files: [attachment],
          embeds: [embed],
        });

        const totalDuration = Date.now() - startTime;
        logger.info(
          {
            objectName,
            requestId,
            fileSize: metadata.size,
            totalDurationMs: totalDuration,
            downloadDurationMs: downloadTime,
            queueWaitMs: acquireTime,
          },
          'Video attached to Discord successfully',
        );

        return { method: 'attached' };
      } finally {
        // Always release semaphore
        this.downloadSemaphore.release();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Handle timeout
      if (errorMessage.includes('timeout')) {
        logger.warn({ objectName, requestId, error: errorMessage }, 'Concurrency timeout');
        return {
          method: 'url',
          reason: 'concurrency_timeout',
          url: this.storageService.publicUrl(objectName),
        };
      }

      // Handle download errors
      if (errorMessage.includes('Failed to download') || errorMessage.includes('File not found')) {
        logger.error({ objectName, requestId, error: errorMessage }, 'Download error');
        return {
          method: 'url',
          reason: 'download_error',
          url: this.storageService.publicUrl(objectName),
        };
      }

      // Handle Discord API errors
      logger.error({ objectName, requestId, error: errorMessage }, 'Discord attachment error');
      return {
        method: 'url',
        reason: 'discord_error',
        url: this.storageService.publicUrl(objectName),
      };
    }
  }
}
