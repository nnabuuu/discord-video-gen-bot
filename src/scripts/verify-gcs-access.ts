#!/usr/bin/env ts-node

/**
 * Script to verify GCS bucket access and permissions
 * Usage: npm run verify:gcs
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { StorageService } from '../storage/storage.service';
import { logger } from '../common/logger';

async function bootstrap() {
  const log = logger.child({ context: 'VerifyGCS' });

  log.info('🔍 Verifying GCS bucket access...');

  // Create NestJS application context
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  const storageService = app.get(StorageService);

  try {
    const bucketName = process.env.OUTPUT_BUCKET || 'discord-video-gen-bot-test';
    const testPrefix = `test-access-${Date.now()}/`;
    const testFileName = `${testPrefix}test.txt`;

    log.info({ bucketName }, '📦 Bucket name');

    // Test 1: Check if bucket exists
    log.info('1️⃣ Checking if bucket exists...');
    const [bucketExists] = await storageService['bucket'].exists();
    if (!bucketExists) {
      log.error('❌ Bucket does not exist');
      process.exit(1);
    }
    log.info('✅ Bucket exists');

    // Test 2: Get bucket metadata
    log.info('2️⃣ Getting bucket metadata...');
    const [metadata] = await storageService['bucket'].getMetadata();
    log.info({
      location: metadata.location,
      storageClass: metadata.storageClass,
      uniformBucketLevelAccess: metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled,
    }, '📋 Bucket metadata');

    // Test 3: Test write permissions
    log.info('3️⃣ Testing write permissions...');
    const file = storageService['bucket'].file(testFileName);
    await file.save('test content', {
      metadata: {
        contentType: 'text/plain',
      },
    });
    log.info({ testFileName }, '✅ Write permission OK');

    // Test 4: Test read permissions
    log.info('4️⃣ Testing read permissions...');
    const [content] = await file.download();
    log.info({ content: content.toString() }, '✅ Read permission OK');

    // Test 5: Test list permissions
    log.info('5️⃣ Testing list permissions...');
    const [files] = await storageService['bucket'].getFiles({ prefix: testPrefix });
    log.info({ fileCount: files.length }, '✅ List permission OK');

    // Test 6: Test public access configuration
    log.info('6️⃣ Testing public access configuration...');
    const publicAccessMode = process.env.PUBLIC_ACCESS_MODE || 'object';
    log.info({ publicAccessMode }, 'Public access mode');

    if (publicAccessMode === 'object') {
      log.info('Testing per-object public access...');
      try {
        await file.makePublic();
        log.info('✅ Per-object makePublic() works');

        // Verify public access
        const publicUrl = storageService.publicUrl(testFileName);
        log.info({ publicUrl }, '🔗 Public URL generated');

        // Try to fetch the public URL
        const response = await fetch(publicUrl);
        if (response.ok) {
          log.info('✅ Public URL is accessible');
        } else {
          log.warn({ status: response.status }, '⚠️ Public URL returned non-200 status');
        }
      } catch (error) {
        log.error({ error }, '❌ Failed to make object public. Ensure Fine-grained ACL is enabled on bucket.');
      }
    } else {
      log.info('Bucket-wide public access mode - skipping makePublic() test');
      const publicUrl = storageService.publicUrl(testFileName);
      log.info({ publicUrl }, '🔗 Public URL generated');

      const response = await fetch(publicUrl);
      if (response.ok) {
        log.info('✅ Public URL is accessible (bucket-wide access)');
      } else {
        log.error({ status: response.status }, '❌ Public URL not accessible. Check bucket IAM policy for allUsers:objectViewer');
      }
    }

    // Test 7: Test delete permissions
    log.info('7️⃣ Testing delete permissions...');
    await file.delete();
    log.info('✅ Delete permission OK');

    // Clean up test prefix
    const [testFiles] = await storageService['bucket'].getFiles({ prefix: testPrefix });
    if (testFiles.length > 0) {
      log.info({ fileCount: testFiles.length }, 'Cleaning up test files...');
      await Promise.all(testFiles.map(f => f.delete()));
    }

    log.info('');
    log.info('🎉 All GCS access checks passed!');
    log.info('');
    log.info('Summary:');
    log.info(`  ✅ Bucket: ${bucketName}`);
    log.info(`  ✅ Location: ${metadata.location}`);
    log.info(`  ✅ Storage Class: ${metadata.storageClass}`);
    log.info(`  ✅ Uniform Bucket-Level Access: ${metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled ? 'Enabled' : 'Disabled'}`);
    log.info(`  ✅ Public Access Mode: ${publicAccessMode}`);
    log.info(`  ✅ Read/Write/List/Delete: OK`);

    // Check Vertex AI service account permissions
    const projectId = process.env.GCP_PROJECT_ID;
    log.info('');
    log.info('8️⃣ Checking Vertex AI service account permissions...');

    if (projectId) {
      log.info('Run these commands to verify Vertex AI can write to the bucket:');
      log.info('');
      log.info(`  gcloud projects describe ${projectId} --format="value(projectNumber)"`);
      log.info('  # Copy the project number from above, then run:');
      log.info(`  gsutil iam get gs://${bucketName} | grep "service-PROJECT_NUMBER@vertex-ai"`);
      log.info('');
      log.info('If not found, grant access with:');
      log.info('');
      log.info(`  gcloud storage buckets add-iam-policy-binding gs://${bucketName} \\`);
      log.info('    --member="serviceAccount:service-PROJECT_NUMBER@vertex-ai.iam.gserviceaccount.com" \\');
      log.info('    --role="roles/storage.objectAdmin"');
    } else {
      log.warn('⚠️ GCP_PROJECT_ID not set in .env - cannot show project-specific commands');
    }

  } catch (error) {
    log.error({ error }, '❌ GCS access verification failed');
    log.error('');
    log.error('Common issues:');
    log.error('  1. SERVICE_ACCOUNT_JSON not set or invalid (for local dev)');
    log.error('  2. Service account lacks storage.objectAdmin role');
    log.error('  3. Bucket does not exist or wrong OUTPUT_BUCKET value');
    log.error('  4. Fine-grained ACL not enabled (for PUBLIC_ACCESS_MODE=object)');
    log.error('  5. allUsers:objectViewer policy missing (for PUBLIC_ACCESS_MODE=bucket)');
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
