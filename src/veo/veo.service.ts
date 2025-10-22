import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { StorageService } from '../storage/storage.service';
import { logger } from '../common/logger';
import { VeoGenerationParams, VeoOperation, VeoRequest } from '../common/types';

const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const INITIAL_POLL_INTERVAL_MS = 1000; // 1 second
const MAX_POLL_INTERVAL_MS = 10000; // 10 seconds
const BACKOFF_MULTIPLIER = 1.5;

@Injectable()
export class VeoService {
  constructor(
    private readonly authService: AuthService,
    private readonly storageService: StorageService,
  ) {}

  async startGeneration(
    params: VeoGenerationParams,
    outputStorageUri: string,
  ): Promise<string> {
    const projectId = process.env.GCP_PROJECT_ID;
    const location = process.env.GCP_LOCATION || 'us-central1';
    const modelId = process.env.VEO_MODEL_ID || 'veo-3.1-generate-preview';

    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predictLongRunning`;

    const requestBody: VeoRequest = {
      instances: [{ prompt: params.prompt }],
      parameters: {
        durationSeconds: params.durationSeconds,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        generateAudio: params.generateAudio,
        sampleCount: params.sampleCount,
        storageUri: outputStorageUri,
      },
    };

    logger.info(
      {
        prompt: params.prompt.substring(0, 50) + (params.prompt.length > 50 ? '...' : ''),
        duration: params.durationSeconds,
      },
      'Starting Veo generation',
    );

    try {
      const token = await this.authService.getAccessToken();

      logger.debug({ endpoint, token: token.substring(0, 20) + '...' }, 'Making API request');

      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });
      } catch (fetchError: any) {
        logger.error(
          {
            error: {
              message: fetchError.message,
              code: fetchError.code,
              cause: fetchError.cause,
              stack: fetchError.stack,
            },
            endpoint,
          },
          'Network error during fetch',
        );
        throw new Error(
          `Network error calling Vertex AI: ${fetchError.message}${
            fetchError.cause ? ` (${fetchError.cause})` : ''
          }`,
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorJson;
        try {
          errorJson = JSON.parse(errorText);
        } catch {
          errorJson = errorText;
        }

        logger.error(
          {
            status: response.status,
            statusText: response.statusText,
            error: errorJson,
            requestBody,
          },
          'Veo generation request failed',
        );

        const errorMessage = typeof errorJson === 'object' && errorJson.error?.message
          ? errorJson.error.message
          : errorText;

        throw new Error(`Veo API error (${response.status}): ${errorMessage}`);
      }

      const result = (await response.json()) as any;

      // Veo predictLongRunning returns an operation name, but polling doesn't work
      // The operation completes asynchronously and writes to GCS
      // We'll return a synthetic operation that just waits and checks GCS
      if (!result.name) {
        logger.error({ result }, 'No operation name in response');
        throw new Error('Invalid response: missing operation name');
      }

      logger.info('Veo generation request accepted');

      // Return the operation name for tracking, but we'll poll GCS instead
      return result.name;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          } : error,
          params,
          endpoint,
        },
        'Failed to start Veo generation',
      );
      throw error;
    }
  }

  private async checkOperationStatus(operationName: string): Promise<{ done: boolean; response?: any; error?: any }> {
    try {
      const token = await this.authService.getAccessToken();
      const operationUrl = `https://us-central1-aiplatform.googleapis.com/v1/${operationName}`;

      const response = await fetch(operationUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        // If operation endpoint doesn't exist (404), return not done
        if (response.status === 404) {
          return { done: false };
        }
        return { done: false };
      }

      const result = await response.json();

      return {
        done: result.done || false,
        response: result.response,
        error: result.error,
      };
    } catch (error) {
      return { done: false };
    }
  }

  async pollOperation(
    operationName: string,
    gcsPrefix: string,
    onProgress?: (progress: number) => Promise<void>,
  ): Promise<VeoOperation> {
    // Try standard operation polling first, fall back to GCS checking if it fails
    const startTime = Date.now();
    let pollInterval = INITIAL_POLL_INTERVAL_MS;

    logger.info('Polling for generation results');

    while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
      try {
        const elapsedMs = Date.now() - startTime;

        // Calculate estimated progress (Veo typically takes 2-4 minutes)
        // Progress is estimated, not real progress from API
        const estimatedDuration = 180000; // 3 minutes average
        const progress = Math.min(elapsedMs / estimatedDuration, 0.95); // Cap at 95% until done

        // Call progress callback if provided
        if (onProgress) {
          try {
            await onProgress(progress);
          } catch (error) {
            logger.warn({ error }, 'Progress callback failed');
          }
        }

        // Try standard operation polling first
        const operationStatus = await this.checkOperationStatus(operationName);
        if (operationStatus.done) {
          // Call final progress update (100%)
          if (onProgress) {
            try {
              await onProgress(1.0);
            } catch (error) {
              // Ignore progress callback errors
            }
          }

          return {
            name: operationName,
            done: true,
            response: operationStatus.response,
            error: operationStatus.error,
          };
        }

        // Fallback: Check if any .mp4 files exist in the GCS prefix
        const files = await this.checkGcsFiles(gcsPrefix);

        if (files.length > 0) {
          // Call final progress update (100%)
          if (onProgress) {
            try {
              await onProgress(1.0);
            } catch (error) {
              // Ignore progress callback errors
            }
          }

          logger.info({ elapsedMs, fileCount: files.length }, 'Generation completed');

          return {
            name: operationName,
            done: true,
          };
        }

        // Wait before next poll
        await this.sleep(pollInterval);

        // Exponential backoff
        pollInterval = Math.min(pollInterval * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL_MS);
      } catch (error) {
        logger.error({ error, operationName, gcsPrefix }, 'Error polling GCS');
        throw error;
      }
    }

    logger.error({ duration: Date.now() - startTime }, 'Generation timed out after 5 minutes');
    throw new Error('Generation timed out after 5 minutes');
  }

  private async checkGcsFiles(prefix: string): Promise<string[]> {
    try {
      const files = await this.storageService.listFiles(prefix);
      return files;
    } catch (error) {
      logger.error({ error, prefix }, 'Failed to check GCS files');
      return [];
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
