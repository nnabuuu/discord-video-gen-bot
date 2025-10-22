import { Injectable, OnModuleInit } from '@nestjs/common';
import { Storage, Bucket } from '@google-cloud/storage';
import { logger } from '../common/logger';
import * as fs from 'fs';

@Injectable()
export class StorageService implements OnModuleInit {
  private storage: Storage;
  private bucket: Bucket;
  private bucketName: string;
  private publicAccessMode: 'object' | 'bucket';

  async onModuleInit() {
    this.bucketName = process.env.OUTPUT_BUCKET || 'discord-video-gen-bot-test';
    this.publicAccessMode = (process.env.PUBLIC_ACCESS_MODE as 'object' | 'bucket') || 'object';

    const serviceAccountPath = process.env.SERVICE_ACCOUNT_JSON;

    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      logger.info({ path: serviceAccountPath }, 'Using service account JSON for GCS');
      this.storage = new Storage({ keyFilename: serviceAccountPath });
    } else {
      logger.info('Using Application Default Credentials for GCS');
      this.storage = new Storage();
    }

    this.bucket = this.storage.bucket(this.bucketName);
    logger.info(
      { bucket: this.bucketName, publicAccessMode: this.publicAccessMode },
      'Storage service initialized',
    );
  }

  async listFiles(prefix: string): Promise<string[]> {
    try {
      const [files] = await this.bucket.getFiles({ prefix });
      const fileNames = files.map((file) => file.name).filter((name) => name.endsWith('.mp4'));

      logger.info({ prefix, count: fileNames.length }, 'Listed files from GCS');
      return fileNames;
    } catch (error) {
      logger.error({ error, prefix }, 'Failed to list files');
      throw error;
    }
  }

  async makePublic(objectName: string): Promise<void> {
    if (this.publicAccessMode === 'bucket') {
      logger.debug({ objectName }, 'Skipping makePublic (bucket-wide access mode)');
      return;
    }

    try {
      const file = this.bucket.file(objectName);
      await file.makePublic();
      logger.info({ objectName }, 'Made object public');
    } catch (error) {
      logger.error({ error, objectName }, 'Failed to make object public');
      throw error;
    }
  }

  publicUrl(objectName: string): string {
    return `https://storage.googleapis.com/${this.bucketName}/${objectName}`;
  }

  buildOutputPrefix(
    guildId: string,
    channelId: string,
    userId: string,
    requestId: string,
  ): string {
    return `discord/${guildId}/${channelId}/${userId}/${requestId}/`;
  }

  buildOutputUri(prefix: string): string {
    return `gs://${this.bucketName}/${prefix}`;
  }
}
