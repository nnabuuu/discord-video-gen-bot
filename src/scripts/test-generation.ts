#!/usr/bin/env ts-node

/**
 * Test script to invoke video generation locally without Discord
 * Usage: npm run test:generation
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { VeoService } from '../veo/veo.service';
import { StorageService } from '../storage/storage.service';
import { Logger } from '../common/logger';

async function bootstrap() {
  const logger = Logger.child({ context: 'TestGeneration' });

  logger.info('🚀 Starting local video generation test...');

  // Create NestJS application context
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  const veoService = app.get(VeoService);
  const storageService = app.get(StorageService);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const prompt = args[0] || 'A serene ocean sunset with gentle waves';
  const length = parseInt(args[1] || '8', 10);
  const ratio = (args[2] || '16:9') as '16:9' | '9:16';
  const hd = args[3] !== 'false';
  const audio = args[4] !== 'false';

  logger.info({
    prompt,
    length,
    ratio,
    hd,
    audio,
  }, 'Generation parameters');

  try {
    // Generate unique request ID
    const requestId = crypto.randomUUID();
    const gcsPrefix = `test/${requestId}/`;

    logger.info({ requestId, gcsPrefix }, '📁 Using GCS prefix');

    // Start generation
    const operationName = await veoService.startGeneration(
      {
        prompt,
        durationSeconds: length,
        aspectRatio: ratio,
        resolution: hd ? '1080p' : '720p',
        generateAudio: audio,
        sampleCount: 1,
      },
      gcsPrefix,
    );

    logger.info({ operationName }, '⏳ Generation started, polling for results...');

    // Poll for completion with progress updates
    await veoService.pollOperation(
      operationName,
      gcsPrefix,
      async (progress) => {
        const percentage = Math.round(progress * 100);
        const progressBar = createProgressBar(progress);
        logger.info(`${progressBar} ${percentage}% complete`);
      },
    );

    logger.info('✅ Generation complete! Listing files...');

    // List generated files
    const files = await storageService.listFiles(gcsPrefix);

    if (files.length === 0) {
      logger.error('❌ No files found after completion');
      process.exit(1);
    }

    logger.info({ fileCount: files.length }, '📹 Found video files');

    // Make files public and get URLs
    const urls: string[] = [];
    for (const file of files) {
      if (file.endsWith('.mp4')) {
        await storageService.makePublic(file);
        const url = storageService.getPublicUrl(file);
        urls.push(url);
        logger.info({ file, url }, '🔗 Public URL generated');
      }
    }

    logger.info('🎉 Test generation complete!');
    logger.info(`Generated ${urls.length} video(s):`);
    urls.forEach((url, i) => {
      console.log(`  ${i + 1}. ${url}`);
    });
  } catch (error) {
    logger.error({ error }, '❌ Generation failed');
    process.exit(1);
  } finally {
    await app.close();
  }
}

function createProgressBar(progress: number): string {
  const blocks = 10;
  const filled = Math.round(progress * blocks);
  const filledBar = '█'.repeat(filled);
  const emptyBar = '░'.repeat(blocks - filled);
  return `${filledBar}${emptyBar}`;
}

bootstrap();
