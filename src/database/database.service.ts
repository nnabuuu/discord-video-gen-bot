import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createPool, DatabasePool, sql } from 'slonik';
import { logger } from '../common/logger';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: DatabasePool | null = null;

  async onModuleInit() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      logger.error('DATABASE_URL environment variable is required');
      throw new Error('DATABASE_URL environment variable is required');
    }

    try {
      const maxConnections = parseInt(process.env.DATABASE_MAX_CONNECTIONS || '10', 10);

      this.pool = await createPool(databaseUrl, {
        maximumPoolSize: maxConnections,
        connectionTimeout: 10000,
        idleTimeout: 30000,
        statementTimeout: 30000,
      });

      // Test connection
      await this.testConnection();

      logger.info(
        {
          maxConnections,
          host: this.sanitizeUrl(databaseUrl),
        },
        'Connected to PostgreSQL',
      );
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          databaseUrl: this.sanitizeUrl(databaseUrl),
        },
        'Failed to connect to PostgreSQL',
      );
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
      logger.info('PostgreSQL connection pool closed');
    }
  }

  getPool(): DatabasePool {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }
    return this.pool;
  }

  async testConnection(): Promise<void> {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }

    const startTime = Date.now();
    await this.pool.query(sql.unsafe`SELECT 1`);
    const latency = Date.now() - startTime;

    logger.debug({ latency }, 'Database health check passed');
  }

  private sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return '[invalid url]';
    }
  }
}
