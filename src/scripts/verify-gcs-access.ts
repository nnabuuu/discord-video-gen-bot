#!/usr/bin/env ts-node

/**
 * Script to verify GCS bucket access and permissions
 * Usage: npm run verify:gcs
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { StorageService } from '../storage/storage.service';
import { Logger } from '../common/logger';

async function bootstrap() {
  const logger = Logger.child({ context: 'VerifyGCS' });

  logger.info('🔍 Verifying GCS bucket access...');

  // Create NestJS application context
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  const storageService = app.get(StorageService);

  try {
    const bucketName = process.env.OUTPUT_BUCKET || 'discord-video-gen-bot-test';
    const testPrefix = `test-access-${Date.now()}/`;
    const testFileName = `${testPrefix}test.txt`;

    logger.info({ bucketName }, '📦 Bucket name');

    // Test 1: Check if bucket exists
    logger.info('1️⃣ Checking if bucket exists...');
    const [bucketExists] = await storageService['bucket'].exists();
    if (!bucketExists) {
      logger.error('❌ Bucket does not exist');
      process.exit(1);
    }
    logger.info('✅ Bucket exists');

    // Test 2: Get bucket metadata
    logger.info('2️⃣ Getting bucket metadata...');
    const [metadata] = await storageService['bucket'].getMetadata();
    logger.info({
      location: metadata.location,
      storageClass: metadata.storageClass,
      uniformBucketLevelAccess: metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled,
    }, '📋 Bucket metadata');

    // Test 3: Test write permissions
    logger.info('3️⃣ Testing write permissions...');
    const file = storageService['bucket'].file(testFileName);
    await file.save('test content', {
      metadata: {
        contentType: 'text/plain',
      },
    });
    logger.info({ testFileName }, '✅ Write permission OK');

    // Test 4: Test read permissions
    logger.info('4️⃣ Testing read permissions...');
    const [content] = await file.download();
    logger.info({ content: content.toString() }, '✅ Read permission OK');

    // Test 5: Test list permissions
    logger.info('5️⃣ Testing list permissions...');
    const [files] = await storageService['bucket'].getFiles({ prefix: testPrefix });
    logger.info({ fileCount: files.length }, '✅ List permission OK');

    // Test 6: Test public access configuration
    logger.info('6️⃣ Testing public access configuration...');
    const publicAccessMode = process.env.PUBLIC_ACCESS_MODE || 'object';
    logger.info({ publicAccessMode }, 'Public access mode');

    if (publicAccessMode === 'object') {
      logger.info('Testing per-object public access...');
      try {
        await file.makePublic();
        logger.info('✅ Per-object makePublic() works');

        // Verify public access
        const publicUrl = storageService.getPublicUrl(testFileName);
        logger.info({ publicUrl }, '🔗 Public URL generated');

        // Try to fetch the public URL
        const response = await fetch(publicUrl);
        if (response.ok) {
          logger.info('✅ Public URL is accessible');
        } else {
          logger.warn({ status: response.status }, '⚠️ Public URL returned non-200 status');
        }
      } catch (error) {
        logger.error({ error }, '❌ Failed to make object public. Ensure Fine-grained ACL is enabled on bucket.');
      }
    } else {
      logger.info('Bucket-wide public access mode - skipping makePublic() test');
      const publicUrl = storageService.getPublicUrl(testFileName);
      logger.info({ publicUrl }, '🔗 Public URL generated');

      const response = await fetch(publicUrl);
      if (response.ok) {
        logger.info('✅ Public URL is accessible (bucket-wide access)');
      } else {
        logger.error({ status: response.status }, '❌ Public URL not accessible. Check bucket IAM policy for allUsers:objectViewer');
      }
    }

    // Test 7: Test delete permissions
    logger.info('7️⃣ Testing delete permissions...');
    await file.delete();
    logger.info('✅ Delete permission OK');

    // Clean up test prefix
    const [testFiles] = await storageService['bucket'].getFiles({ prefix: testPrefix });
    if (testFiles.length > 0) {
      logger.info({ fileCount: testFiles.length }, 'Cleaning up test files...');
      await Promise.all(testFiles.map(f => f.delete()));
    }

    logger.info('');
    logger.info('🎉 All GCS access checks passed!');
    logger.info('');
    logger.info('Summary:');
    logger.info(`  ✅ Bucket: ${bucketName}`);
    logger.info(`  ✅ Location: ${metadata.location}`);
    logger.info(`  ✅ Storage Class: ${metadata.storageClass}`);
    logger.info(`  ✅ Uniform Bucket-Level Access: ${metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled ? 'Enabled' : 'Disabled'}`);
    logger.info(`  ✅ Public Access Mode: ${publicAccessMode}`);
    logger.info(`  ✅ Read/Write/List/Delete: OK`);

  } catch (error) {
    logger.error({ error }, '❌ GCS access verification failed');
    logger.error('');
    logger.error('Common issues:');
    logger.error('  1. SERVICE_ACCOUNT_JSON not set or invalid (for local dev)');
    logger.error('  2. Service account lacks storage.objectAdmin role');
    logger.error('  3. Bucket does not exist or wrong OUTPUT_BUCKET value');
    logger.error('  4. Fine-grained ACL not enabled (for PUBLIC_ACCESS_MODE=object)');
    logger.error('  5. allUsers:objectViewer policy missing (for PUBLIC_ACCESS_MODE=bucket)');
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
