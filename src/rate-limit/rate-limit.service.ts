import { Injectable } from '@nestjs/common';
import { logger } from '../common/logger';
import { RateLimitResult } from '../common/types';
import { RequestTrackingService } from '../database/request-tracking.service';
import { RequestType } from '../database/database.types';

const VEO_QUOTA_LIMIT = 5;
const BANANA_QUOTA_LIMIT = 10;
const QUOTA_WINDOW_HOURS = 24;

@Injectable()
export class RateLimitService {
  constructor(private readonly requestTrackingService: RequestTrackingService) {}

  private getQuotaLimit(requestType: RequestType): number {
    return requestType === RequestType.BANANA ? BANANA_QUOTA_LIMIT : VEO_QUOTA_LIMIT;
  }

  async consume(userId: string, requestType: RequestType = RequestType.VEO): Promise<RateLimitResult> {
    const quotaLimit = this.getQuotaLimit(requestType);

    try {
      // Count recent requests in the last 24 hours for this type
      const count = await this.requestTrackingService.countRecentRequests(
        userId,
        QUOTA_WINDOW_HOURS,
        requestType,
      );

      if (count >= quotaLimit) {
        // Get oldest request to calculate reset time
        const oldestRequest = await this.requestTrackingService.getOldestRequestTime(
          userId,
          QUOTA_WINDOW_HOURS,
          requestType,
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
        remaining: quotaLimit - count,
      };
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          userId,
          requestType,
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

  async getRemainingQuota(userId: string, requestType: RequestType = RequestType.VEO): Promise<number> {
    const quotaLimit = this.getQuotaLimit(requestType);

    try {
      const count = await this.requestTrackingService.countRecentRequests(
        userId,
        QUOTA_WINDOW_HOURS,
        requestType,
      );
      return Math.max(0, quotaLimit - count);
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          userId,
          requestType,
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
