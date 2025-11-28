import { Injectable } from '@nestjs/common';
import { sql } from 'slonik';
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { DatabaseService } from './database.service';
import { UserApiKeyRow, UserApiKeyStatus } from './database.types';
import { logger } from '../common/logger';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const CODE_EXPIRY_MINUTES = 10;
const DEFAULT_BASE_URL = 'http://localhost:3000';

@Injectable()
export class UserApiKeyService {
  private encryptionKey: Buffer | null = null;

  constructor(private readonly databaseService: DatabaseService) {
    const secret = process.env.API_KEY_ENCRYPTION_SECRET;
    if (secret) {
      // Derive a 32-byte key from the secret
      this.encryptionKey = Buffer.from(secret.padEnd(32, '0').slice(0, 32));
      logger.info('API key encryption enabled');
    } else {
      logger.warn('API_KEY_ENCRYPTION_SECRET not set - user API key functionality disabled');
    }
  }

  private encrypt(plaintext: string): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption not configured');
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted (all base64)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  }

  private decrypt(encryptedData: string): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption not configured');
    }

    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = parts[2];

    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  private maskApiKey(apiKey: string): string {
    if (apiKey.length <= 8) {
      return '****';
    }
    return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
  }

  async generateConnectionCode(userId: string): Promise<{ code: string; url: string; hasExistingKey: boolean }> {
    const pool = this.databaseService.getPool();
    const code = randomUUID();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

    try {
      // Check if user has existing API key
      const existing = await pool.maybeOne(sql.unsafe`
        SELECT api_key_encrypted FROM user_api_keys WHERE user_id = ${userId}
      `) as { api_key_encrypted: string | null } | null;

      const hasExistingKey = !!(existing?.api_key_encrypted);

      // Upsert connection code
      await pool.query(sql.unsafe`
        INSERT INTO user_api_keys (user_id, connection_code, code_expires_at, updated_at)
        VALUES (${userId}, ${code}, ${expiresAt.toISOString()}, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          connection_code = ${code},
          code_expires_at = ${expiresAt.toISOString()},
          updated_at = NOW()
      `);

      const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
      const url = `${baseUrl}/connect?code=${code}`;

      logger.info(
        { userId, codePrefix: code.slice(0, 8), expiresAt, hasExistingKey },
        'Generated connection code',
      );

      return { code, url, hasExistingKey };
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : error, userId },
        'Failed to generate connection code',
      );
      throw error;
    }
  }

  async getStatusByCode(code: string): Promise<UserApiKeyStatus | null> {
    const pool = this.databaseService.getPool();

    try {
      const row = await pool.maybeOne(sql.unsafe`
        SELECT * FROM user_api_keys
        WHERE connection_code = ${code}
      `) as UserApiKeyRow | null;

      if (!row) {
        return null;
      }

      // Check expiration
      if (row.code_expires_at && new Date(row.code_expires_at) < new Date()) {
        return null; // Code expired
      }

      let maskedKey: string | null = null;
      if (row.api_key_encrypted && this.encryptionKey) {
        try {
          const decrypted = this.decrypt(row.api_key_encrypted);
          maskedKey = this.maskApiKey(decrypted);
        } catch {
          logger.warn({ userId: row.user_id }, 'Failed to decrypt API key for status');
        }
      }

      return {
        hasKey: !!row.api_key_encrypted,
        maskedKey,
        // Slonik returns timestamps as strings, convert to ISO format
        connectedAt: row.api_key_encrypted && row.updated_at
          ? new Date(row.updated_at).toISOString()
          : null,
      };
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : error },
        'Failed to get status by code',
      );
      return null;
    }
  }

  async setApiKeyByCode(code: string, apiKey: string): Promise<{ success: boolean; maskedKey?: string; error?: string }> {
    if (!this.encryptionKey) {
      return { success: false, error: 'API key encryption not configured' };
    }

    const pool = this.databaseService.getPool();

    try {
      // Find record by code
      const row = await pool.maybeOne(sql.unsafe`
        SELECT * FROM user_api_keys
        WHERE connection_code = ${code}
      `) as UserApiKeyRow | null;

      if (!row) {
        return { success: false, error: 'Invalid connection code' };
      }

      // Check expiration
      if (row.code_expires_at && new Date(row.code_expires_at) < new Date()) {
        return { success: false, error: 'Connection code has expired. Please run /api-key connect again.' };
      }

      // Encrypt and store
      const encrypted = this.encrypt(apiKey);

      await pool.query(sql.unsafe`
        UPDATE user_api_keys
        SET
          api_key_encrypted = ${encrypted},
          updated_at = NOW()
        WHERE connection_code = ${code}
      `);

      const maskedKey = this.maskApiKey(apiKey);

      logger.info(
        { userId: row.user_id, maskedKey },
        'API key bound successfully',
      );

      return { success: true, maskedKey };
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : error },
        'Failed to set API key by code',
      );
      return { success: false, error: 'Failed to save API key' };
    }
  }

  async removeApiKeyByCode(code: string): Promise<{ success: boolean; error?: string }> {
    const pool = this.databaseService.getPool();

    try {
      // Find record by code
      const row = await pool.maybeOne(sql.unsafe`
        SELECT * FROM user_api_keys
        WHERE connection_code = ${code}
      `) as UserApiKeyRow | null;

      if (!row) {
        return { success: false, error: 'Invalid connection code' };
      }

      // Check expiration
      if (row.code_expires_at && new Date(row.code_expires_at) < new Date()) {
        return { success: false, error: 'Connection code has expired. Please run /api-key connect again.' };
      }

      if (!row.api_key_encrypted) {
        return { success: false, error: 'No API key is connected to this account' };
      }

      await pool.query(sql.unsafe`
        UPDATE user_api_keys
        SET
          api_key_encrypted = NULL,
          updated_at = NOW()
        WHERE connection_code = ${code}
      `);

      logger.info({ userId: row.user_id }, 'API key removed successfully');

      return { success: true };
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : error },
        'Failed to remove API key by code',
      );
      return { success: false, error: 'Failed to remove API key' };
    }
  }

  async getApiKey(userId: string): Promise<string | null> {
    if (!this.encryptionKey) {
      return null;
    }

    const pool = this.databaseService.getPool();

    try {
      const row = await pool.maybeOne(sql.unsafe`
        SELECT api_key_encrypted FROM user_api_keys
        WHERE user_id = ${userId}
      `) as { api_key_encrypted: string | null } | null;

      if (!row?.api_key_encrypted) {
        return null;
      }

      return this.decrypt(row.api_key_encrypted);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : error, userId },
        'Failed to get API key',
      );
      return null;
    }
  }

  async hasApiKey(userId: string): Promise<boolean> {
    const pool = this.databaseService.getPool();

    try {
      const row = await pool.maybeOne(sql.unsafe`
        SELECT api_key_encrypted FROM user_api_keys
        WHERE user_id = ${userId}
      `) as { api_key_encrypted: string | null } | null;

      return !!row?.api_key_encrypted;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : error, userId },
        'Failed to check API key existence',
      );
      return false;
    }
  }

  async removeApiKey(userId: string): Promise<boolean> {
    const pool = this.databaseService.getPool();

    try {
      const result = await pool.query(sql.unsafe`
        DELETE FROM user_api_keys
        WHERE user_id = ${userId}
      `);

      const deleted = result.rowCount > 0;
      if (deleted) {
        logger.info({ userId }, 'API key removed by user');
      }

      return deleted;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : error, userId },
        'Failed to remove API key',
      );
      return false;
    }
  }

  async getStatusByUserId(userId: string): Promise<UserApiKeyStatus> {
    const pool = this.databaseService.getPool();

    try {
      const row = await pool.maybeOne(sql.unsafe`
        SELECT * FROM user_api_keys
        WHERE user_id = ${userId}
      `) as UserApiKeyRow | null;

      if (!row || !row.api_key_encrypted) {
        return { hasKey: false, maskedKey: null, connectedAt: null };
      }

      let maskedKey: string | null = null;
      if (this.encryptionKey) {
        try {
          const decrypted = this.decrypt(row.api_key_encrypted);
          maskedKey = this.maskApiKey(decrypted);
        } catch {
          logger.warn({ userId }, 'Failed to decrypt API key for status');
        }
      }

      return {
        hasKey: true,
        maskedKey,
        // Slonik returns timestamps as strings
        connectedAt: new Date(row.updated_at).toISOString(),
      };
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : error, userId },
        'Failed to get status by user ID',
      );
      return { hasKey: false, maskedKey: null, connectedAt: null };
    }
  }
}
