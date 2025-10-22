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

      // Veo predictLongRunning returns an operation name, but polling doesn't work
      // The operation completes asynchronously and writes to GCS
      // We'll return a synthetic operation that just waits and checks GCS
      if (!result.name) {
        logger.error({ result }, 'No operation name in response');
        throw new Error('Invalid response: missing operation name');
      }

      logger.info({ operationName: result.name }, 'Veo generation request accepted');

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

  async pollOperation(operationName: string): Promise<VeoOperation> {
    // Veo predictLongRunning doesn't support standard operation polling
    // Instead, it writes results directly to GCS asynchronously
    // We wait a fixed time and then check GCS for output files

    const startTime = Date.now();
    logger.info({ operationName }, 'Waiting for Veo generation to complete (GCS-based)');

    // Veo typically takes 2-4 minutes for generation
    // Wait 2 minutes before checking
    const waitTime = 120000; // 2 minutes
    await this.sleep(waitTime);

    logger.info(
      { operationName, waitedMs: Date.now() - startTime },
      'Generation wait period completed',
    );

    // Return a synthetic "done" operation
    // The actual result checking happens by listing GCS files
    return {
      name: operationName,
      done: true,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
