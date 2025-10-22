import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { logger } from '../common/logger';
import { RateLimitResult } from '../common/types';

const QUOTA_LIMIT = 5;
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis | null = null;
  private inMemoryStore: Map<string, number[]> = new Map();
  private useRedis = false;

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl);
        this.useRedis = true;
        logger.info({ redisUrl }, 'Connected to Redis for rate limiting');

        this.redis.on('error', (err) => {
          logger.error({ err }, 'Redis error');
        });
      } catch (error) {
        logger.warn({ error }, 'Failed to connect to Redis, using in-memory fallback');
        this.useRedis = false;
      }
    } else {
      logger.info('No REDIS_URL configured, using in-memory rate limiting (dev only)');
      this.useRedis = false;
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  async consume(userId: string): Promise<RateLimitResult> {
    if (this.useRedis && this.redis) {
      return this.consumeRedis(userId);
    } else {
      return this.consumeInMemory(userId);
    }
  }

  private async consumeRedis(userId: string): Promise<RateLimitResult> {
    const key = `rl:${userId}`;
    const now = Date.now();
    const windowStart = now - QUOTA_WINDOW_MS;

    try {
      // Remove old entries
      await this.redis!.zremrangebyscore(key, '-inf', windowStart);

      // Count current entries
      const count = await this.redis!.zcard(key);

      if (count >= QUOTA_LIMIT) {
        // Get oldest entry to calculate wait time
        const oldest = await this.redis!.zrange(key, 0, 0, 'WITHSCORES');
        const oldestTimestamp = oldest.length > 1 ? parseInt(oldest[1]) : now;
        const resetTime = oldestTimestamp + QUOTA_WINDOW_MS;
        const waitSeconds = Math.ceil((resetTime - now) / 1000);

        return {
          allowed: false,
          remaining: 0,
          resetTime,
          waitSeconds: Math.max(0, waitSeconds),
        };
      }

      // Add new entry
      const requestId = `${now}-${Math.random()}`;
      await this.redis!.zadd(key, now, requestId);

      // Set expiry for cleanup (48 hours to be safe)
      await this.redis!.expire(key, 48 * 60 * 60);

      return {
        allowed: true,
        remaining: QUOTA_LIMIT - count - 1,
      };
    } catch (error) {
      logger.error({ error, userId }, 'Redis rate limit error');
      throw error;
    }
  }

  private async consumeInMemory(userId: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - QUOTA_WINDOW_MS;

    // Get or create user's request timestamps
    let timestamps = this.inMemoryStore.get(userId) || [];

    // Remove old entries
    timestamps = timestamps.filter((ts) => ts > windowStart);

    if (timestamps.length >= QUOTA_LIMIT) {
      const oldestTimestamp = Math.min(...timestamps);
      const resetTime = oldestTimestamp + QUOTA_WINDOW_MS;
      const waitSeconds = Math.ceil((resetTime - now) / 1000);

      this.inMemoryStore.set(userId, timestamps);

      return {
        allowed: false,
        remaining: 0,
        resetTime,
        waitSeconds: Math.max(0, waitSeconds),
      };
    }

    // Add new timestamp
    timestamps.push(now);
    this.inMemoryStore.set(userId, timestamps);

    return {
      allowed: true,
      remaining: QUOTA_LIMIT - timestamps.length,
    };
  }

  async getRemainingQuota(userId: string): Promise<number> {
    const now = Date.now();
    const windowStart = now - QUOTA_WINDOW_MS;

    if (this.useRedis && this.redis) {
      const key = `rl:${userId}`;
      await this.redis.zremrangebyscore(key, '-inf', windowStart);
      const count = await this.redis.zcard(key);
      return Math.max(0, QUOTA_LIMIT - count);
    } else {
      let timestamps = this.inMemoryStore.get(userId) || [];
      timestamps = timestamps.filter((ts) => ts > windowStart);
      this.inMemoryStore.set(userId, timestamps);
      return Math.max(0, QUOTA_LIMIT - timestamps.length);
    }
  }
}
