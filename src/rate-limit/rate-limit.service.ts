import { Injectable } from '@nestjs/common';
import { logger } from '../common/logger';
import { RateLimitResult } from '../common/types';
import { RequestTrackingService } from '../database/request-tracking.service';

const QUOTA_LIMIT = 5;
const QUOTA_WINDOW_HOURS = 24;

@Injectable()
export class RateLimitService {
  constructor(private readonly requestTrackingService: RequestTrackingService) {}

  async consume(userId: string): Promise<RateLimitResult> {
    try {
      // Count recent requests in the last 24 hours
      const count = await this.requestTrackingService.countRecentRequests(
        userId,
        QUOTA_WINDOW_HOURS,
      );

      if (count >= QUOTA_LIMIT) {
        // Get oldest request to calculate reset time
        const oldestRequest = await this.requestTrackingService.getOldestRequestTime(
          userId,
          QUOTA_WINDOW_HOURS,
        );

        if (oldestRequest) {
          const resetTime = oldestRequest.getTime() + QUOTA_WINDOW_HOURS * 60 * 60 * 1000;
          const waitSeconds = Math.ceil((resetTime - Date.now()) / 1000);

          return {
            allowed: false,
            remaining: 0,
            resetTime,
            waitSeconds: Math.max(0, waitSeconds),
          };
        } else {
          // Shouldn't happen, but fail safe
          return {
            allowed: false,
            remaining: 0,
            waitSeconds: 3600, // 1 hour default
          };
        }
      }

      return {
        allowed: true,
        remaining: QUOTA_LIMIT - count,
      };
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          userId,
        },
        'Rate limiting degraded - database unavailable',
      );

      // Graceful degradation: allow request if database is down
      return {
        allowed: true,
        remaining: 0,
      };
    }
  }

  async getRemainingQuota(userId: string): Promise<number> {
    try {
      const count = await this.requestTrackingService.countRecentRequests(
        userId,
        QUOTA_WINDOW_HOURS,
      );
      return Math.max(0, QUOTA_LIMIT - count);
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          userId,
        },
        'Failed to get remaining quota',
      );
      return 0;
    }
  }
}

/*
 * REMOVED: Redis and in-memory implementations
 *
 * The previous Redis-based and in-memory rate limiting code has been replaced
 * with database-backed rate limiting using PostgreSQL queries.
 *
 * Migration note: Rate limit data from Redis/memory is NOT migrated.
 * All users start with a fresh 24-hour quota window after deployment.
 *
 * Benefits of database-backed approach:
 * - Persistent across restarts
 * - Auditable (see which requests counted toward quota)
 * - Simpler architecture (no separate Redis dependency)
 * - Graceful degradation if database unavailable
 */
