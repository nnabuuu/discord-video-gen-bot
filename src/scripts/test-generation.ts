#!/usr/bin/env ts-node

/**
 * Test script to invoke video generation locally without Discord
 * Usage: npm run test:generation
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { VeoService } from '../veo/veo.service';
import { StorageService } from '../storage/storage.service';
import { logger } from '../common/logger';

async function bootstrap() {
  const log = logger.child({ context: 'TestGeneration' });

  log.info('🚀 Starting local video generation test...');

  // Create NestJS application context
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  const veoService = app.get(VeoService);
  const storageService = app.get(StorageService);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const prompt = args[0] || 'A serene ocean sunset with gentle waves';
  const length = (parseInt(args[1] || '8', 10) as 4 | 6 | 8);
  const ratio = (args[2] || '16:9') as '16:9' | '9:16';
  const hd = args[3] !== 'false';
  const audio = args[4] !== 'false';

  log.info({
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
    const outputUri = storageService.buildOutputUri(gcsPrefix);

    log.info({ requestId, gcsPrefix, outputUri }, '📁 Using GCS prefix');

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
      outputUri,
    );

    log.info({ operationName }, '⏳ Generation started, polling for results...');

    // Poll for completion with progress updates
    await veoService.pollOperation(
      operationName,
      gcsPrefix,
      async (progress) => {
        const percentage = Math.round(progress * 100);
        const progressBar = createProgressBar(progress);
        log.info(`${progressBar} ${percentage}% complete`);
      },
    );

    log.info('✅ Generation complete! Listing files...');

    // List generated files
    const files = await storageService.listFiles(gcsPrefix);

    if (files.length === 0) {
      log.error('❌ No files found after completion');
      process.exit(1);
    }

    log.info({ fileCount: files.length }, '📹 Found video files');

    // Make files public and get URLs
    const urls: string[] = [];
    for (const file of files) {
      if (file.endsWith('.mp4')) {
        await storageService.makePublic(file);
        const url = storageService.publicUrl(file);
        urls.push(url);
        log.info({ file, url }, '🔗 Public URL generated');
      }
    }

    log.info('🎉 Test generation complete!');
    log.info(`Generated ${urls.length} video(s):`);
    urls.forEach((url, i) => {
      console.log(`  ${i + 1}. ${url}`);
    });
  } catch (error) {
    log.error({ error }, '❌ Generation failed');
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
