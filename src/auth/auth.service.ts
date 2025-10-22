import { Injectable, OnModuleInit } from '@nestjs/common';
import { GoogleAuth } from 'google-auth-library';
import { logger } from '../common/logger';
import * as fs from 'fs';

@Injectable()
export class AuthService implements OnModuleInit {
  private auth: GoogleAuth;
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;

  async onModuleInit() {
    const serviceAccountPath = process.env.SERVICE_ACCOUNT_JSON;

    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      logger.info({ path: serviceAccountPath }, 'Using service account JSON for authentication');
      const keyFile = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
      this.auth = new GoogleAuth({
        credentials: keyFile,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
    } else {
      logger.info('Using Application Default Credentials (ADC)');
      this.auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
    }
  }

  async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 5 minute buffer)
    const now = Date.now();
    if (this.cachedToken && this.tokenExpiry > now + 5 * 60 * 1000) {
      return this.cachedToken;
    }

    try {
      const client = await this.auth.getClient();
      const tokenResponse = await client.getAccessToken();

      if (!tokenResponse.token) {
        throw new Error('Failed to obtain access token');
      }

      this.cachedToken = tokenResponse.token;
      // Set expiry (tokens typically last 1 hour)
      this.tokenExpiry = now + 55 * 60 * 1000; // 55 minutes

      logger.debug('Access token refreshed');
      return this.cachedToken;
    } catch (error) {
      logger.error({ error }, 'Failed to get access token');
      throw error;
    }
  }
}
