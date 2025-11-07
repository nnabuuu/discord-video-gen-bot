import { Injectable } from '@nestjs/common';
import { sql } from 'slonik';
import { DatabaseService } from './database.service';
import {
  VideoRequestRow,
  VideoRequestStatus,
  CreateVideoRequestInput,
  UpdateVideoRequestInput,
} from './database.types';
import { logger } from '../common/logger';

@Injectable()
export class RequestTrackingService {
  constructor(private readonly databaseService: DatabaseService) {}

  async createRequest(input: CreateVideoRequestInput): Promise<string> {
    try {
      const pool = this.databaseService.getPool();

      const result = await pool.one(sql.unsafe`
        INSERT INTO video_requests (
          user_id,
          guild_id,
          channel_id,
          prompt,
          duration_seconds,
          aspect_ratio,
          resolution,
          generate_audio,
          status
        ) VALUES (
          ${input.user_id},
          ${input.guild_id},
          ${input.channel_id},
          ${input.prompt},
          ${input.duration_seconds},
          ${input.aspect_ratio},
          ${input.resolution},
          ${input.generate_audio},
          ${VideoRequestStatus.PENDING}
        )
        RETURNING id
      `) as { id: string };

      logger.info(
        {
          requestId: result.id,
          userId: input.user_id,
          guildId: input.guild_id,
          prompt: input.prompt.substring(0, 50),
        },
        'Created video request',
      );

      return result.id;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          input: { ...input, prompt: input.prompt.substring(0, 50) },
        },
        'Failed to create video request',
      );
      // Graceful degradation: return synthetic ID
      return `synthetic-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    }
  }

  async setGenerating(
    id: string,
    operationName: string,
    gcsPrefix: string,
  ): Promise<void> {
    try {
      const pool = this.databaseService.getPool();

      await pool.query(sql.unsafe`
        UPDATE video_requests
        SET
          status = ${VideoRequestStatus.GENERATING},
          operation_name = ${operationName},
          gcs_prefix = ${gcsPrefix},
          started_at = NOW()
        WHERE id = ${id}
      `);

      logger.info({ requestId: id, operationName }, 'Request status updated to generating');
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          requestId: id,
        },
        'Failed to update request status to generating',
      );
    }
  }

  async setCompleted(id: string, videoUrls: string[]): Promise<void> {
    try {
      const pool = this.databaseService.getPool();

      await pool.query(sql.unsafe`
        UPDATE video_requests
        SET
          status = ${VideoRequestStatus.COMPLETED},
          video_urls = ${sql.array(videoUrls, 'text')},
          completed_at = NOW(),
          duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
        WHERE id = ${id}
      `);

      logger.info({ requestId: id, videoCount: videoUrls.length }, 'Request completed successfully');
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          requestId: id,
        },
        'Failed to update request status to completed',
      );
    }
  }

  async setFailed(id: string, errorMessage: string): Promise<void> {
    try {
      const pool = this.databaseService.getPool();

      // Sanitize error message (limit length)
      const sanitizedError = errorMessage.substring(0, 500);

      await pool.query(sql.unsafe`
        UPDATE video_requests
        SET
          status = ${VideoRequestStatus.FAILED},
          error_message = ${sanitizedError},
          completed_at = NOW(),
          duration_ms = CASE
            WHEN started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
            ELSE NULL
          END
        WHERE id = ${id}
      `);

      logger.warn(
        {
          requestId: id,
          error: sanitizedError,
        },
        'Request failed',
      );
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          requestId: id,
        },
        'Failed to update request status to failed',
      );
    }
  }

  async setTimeout(id: string, errorMessage: string = 'Generation timed out after 5 minutes'): Promise<void> {
    try {
      const pool = this.databaseService.getPool();

      await pool.query(sql.unsafe`
        UPDATE video_requests
        SET
          status = ${VideoRequestStatus.TIMEOUT},
          error_message = ${errorMessage},
          completed_at = NOW(),
          duration_ms = CASE
            WHEN started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
            ELSE NULL
          END
        WHERE id = ${id}
      `);

      logger.warn({ requestId: id, errorMessage }, 'Request timed out');
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          requestId: id,
        },
        'Failed to update request status to timeout',
      );
    }
  }

  async getRequestById(id: string): Promise<VideoRequestRow | null> {
    try {
      const pool = this.databaseService.getPool();

      const result = await pool.maybeOne(sql.unsafe`
        SELECT * FROM video_requests WHERE id = ${id}
      `) as VideoRequestRow | null;

      return result;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          requestId: id,
        },
        'Failed to get request by ID',
      );
      return null;
    }
  }

  async getRequestsByUser(
    userId: string,
    options: { limit?: number; offset?: number; status?: VideoRequestStatus } = {},
  ): Promise<VideoRequestRow[]> {
    try {
      const pool = this.databaseService.getPool();
      const { limit = 50, offset = 0, status } = options;

      const statusFilter = status ? sql.unsafe`AND status = ${status}` : sql.unsafe``;

      const results = await pool.any(sql.unsafe`
        SELECT * FROM video_requests
        WHERE user_id = ${userId}
        ${statusFilter}
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `) as VideoRequestRow[];

      return results;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          userId,
        },
        'Failed to get requests by user',
      );
      return [];
    }
  }

  async countRecentRequests(userId: string, hoursAgo: number = 24): Promise<number> {
    try {
      const pool = this.databaseService.getPool();

      const result = await pool.one(sql.unsafe`
        SELECT COUNT(*) as count
        FROM video_requests
        WHERE user_id = ${userId}
          AND created_at >= NOW() - INTERVAL '1 hour' * ${hoursAgo}
      `) as { count: string };

      return parseInt(result.count, 10);
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          userId,
        },
        'Failed to count recent requests',
      );
      return 0;
    }
  }

  async getOldestRequestTime(userId: string, hoursAgo: number = 24): Promise<Date | null> {
    try {
      const pool = this.databaseService.getPool();

      const result = await pool.maybeOne(sql.unsafe`
        SELECT created_at
        FROM video_requests
        WHERE user_id = ${userId}
          AND created_at >= NOW() - INTERVAL '1 hour' * ${hoursAgo}
        ORDER BY created_at ASC
        LIMIT 1
      `) as { created_at: Date } | null;

      return result?.created_at || null;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          userId,
        },
        'Failed to get oldest request time',
      );
      return null;
    }
  }

  async getIncompleteRequests(maxAgeHours: number = 24): Promise<VideoRequestRow[]> {
    try {
      const pool = this.databaseService.getPool();

      const results = await pool.any(sql.unsafe`
        SELECT * FROM video_requests
        WHERE status IN ('pending', 'generating')
          AND created_at >= NOW() - INTERVAL '1 hour' * ${maxAgeHours}
        ORDER BY created_at ASC
      `) as VideoRequestRow[];

      logger.info(
        {
          count: results.length,
          maxAgeHours,
        },
        'Fetched incomplete requests',
      );

      return results;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          maxAgeHours,
        },
        'Failed to get incomplete requests',
      );
      return [];
    }
  }
}
