import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { logger } from '../common/logger';
import { VeoGenerationParams, VeoOperation, VeoRequest } from '../common/types';

const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const INITIAL_POLL_INTERVAL_MS = 1000; // 1 second
const MAX_POLL_INTERVAL_MS = 10000; // 10 seconds
const BACKOFF_MULTIPLIER = 1.5;

@Injectable()
export class VeoService {
  constructor(private readonly authService: AuthService) {}

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
        outputGcsUri: outputStorageUri,
      },
    };

    logger.info(
      {
        endpoint,
        params,
        outputStorageUri,
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

      logger.info({ fullResponse: result }, 'Veo API response received');

      if (!result.name) {
        logger.error({ result }, 'No operation name in response');
        throw new Error('Invalid response: missing operation name');
      }

      logger.info({ operationName: result.name }, 'Veo generation started');
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

  async pollOperation(operationName: string): Promise<VeoOperation> {
    const startTime = Date.now();
    let pollInterval = INITIAL_POLL_INTERVAL_MS;
    const location = process.env.GCP_LOCATION || 'us-central1';

    // Use the exact operation name returned by the API for polling
    // The operation name already contains the full path
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/${operationName}`;

    logger.info({ operationName, endpoint }, 'Starting to poll operation');

    while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
      try {
        const token = await this.authService.getAccessToken();

        const response = await fetch(endpoint, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            {
              status: response.status,
              statusText: response.statusText,
              error: errorText,
              operationName,
            },
            'Operation poll failed',
          );
          throw new Error(`Poll error (${response.status}): ${errorText}`);
        }

        const operation = (await response.json()) as VeoOperation;

        if (operation.error) {
          logger.error({ operation }, 'Operation completed with error');
          throw new Error(
            `Generation failed: ${operation.error.message} (code: ${operation.error.code})`,
          );
        }

        if (operation.done) {
          logger.info({ operationName }, 'Operation completed successfully');
          return operation;
        }

        logger.debug(
          { operationName, pollInterval, elapsed: Date.now() - startTime },
          'Operation still running',
        );

        // Wait before next poll
        await this.sleep(pollInterval);

        // Exponential backoff
        pollInterval = Math.min(pollInterval * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL_MS);
      } catch (error) {
        logger.error({ error, operationName }, 'Error during polling');
        throw error;
      }
    }

    logger.error({ operationName, duration: Date.now() - startTime }, 'Operation timed out');
    throw new Error('Operation timed out after 5 minutes');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
