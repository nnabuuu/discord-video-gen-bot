import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { StorageService } from '../storage/storage.service';
import { logger } from '../common/logger';
import { BananaGenerationParams, BananaOperation, BananaRequest } from '../common/types';
import * as fs from 'fs';
import * as path from 'path';

const MAX_POLL_DURATION_MS = 3 * 60 * 1000; // 3 minutes
const INITIAL_POLL_INTERVAL_MS = 1000; // 1 second
const MAX_POLL_INTERVAL_MS = 5000; // 5 seconds
const BACKOFF_MULTIPLIER = 1.5;

type BananaApiMode = 'vertex' | 'gemini';

@Injectable()
export class BananaService {
  private apiMode: BananaApiMode;

  constructor(
    private readonly authService: AuthService,
    private readonly storageService: StorageService,
  ) {
    this.apiMode = (process.env.BANANA_API_MODE as BananaApiMode) || 'gemini';
    logger.info({ apiMode: this.apiMode }, 'Banana service initialized');
  }

  async startGeneration(
    params: BananaGenerationParams,
    outputStorageUri: string,
  ): Promise<string> {
    if (this.apiMode === 'gemini') {
      return this.startGenerationGemini(params, outputStorageUri);
    } else {
      return this.startGenerationVertex(params, outputStorageUri);
    }
  }

  private async startGenerationGemini(
    params: BananaGenerationParams,
    outputStorageUri: string,
  ): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required when BANANA_API_MODE=gemini');
    }

    const modelId = process.env.BANANA_MODEL_ID || 'gemini-3-pro-image-preview';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: params.prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
      },
    };

    logger.info(
      {
        prompt: params.prompt.substring(0, 50) + (params.prompt.length > 50 ? '...' : ''),
        aspectRatio: params.aspectRatio,
        apiMode: 'gemini',
      },
      'Starting Banana image generation (Gemini API)',
    );

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

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
          },
          'Banana generation request failed (Gemini API)',
        );

        const errorMessage = typeof errorJson === 'object' && errorJson.error?.message
          ? errorJson.error.message
          : errorText;

        throw new Error(`Banana API error (${response.status}): ${errorMessage}`);
      }

      const result = (await response.json()) as any;

      // Gemini API returns inline image data, save to GCS
      const imageData = this.extractImageFromGeminiResponse(result);
      if (!imageData) {
        throw new Error('No image data in Gemini response');
      }

      // Save image to GCS
      const prefix = outputStorageUri.replace(`gs://${process.env.OUTPUT_BUCKET}/`, '');
      const fileName = `${prefix}image_0.png`;
      await this.storageService.uploadBuffer(Buffer.from(imageData, 'base64'), fileName, 'image/png');

      logger.info('Banana generation completed (Gemini API)');

      // Return a synthetic operation name since Gemini API is synchronous
      return `gemini-sync-${Date.now()}`;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          } : error,
          params,
        },
        'Failed to start Banana generation (Gemini API)',
      );
      throw error;
    }
  }

  private extractImageFromGeminiResponse(result: any): string | null {
    try {
      const candidates = result.candidates || [];
      for (const candidate of candidates) {
        const parts = candidate.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData?.mimeType?.startsWith('image/')) {
            return part.inlineData.data;
          }
        }
      }
      return null;
    } catch (error) {
      logger.error({ error, result }, 'Failed to extract image from Gemini response');
      return null;
    }
  }

  private async startGenerationVertex(
    params: BananaGenerationParams,
    outputStorageUri: string,
  ): Promise<string> {
    const projectId = process.env.GCP_PROJECT_ID;
    const location = process.env.GCP_LOCATION || 'us-central1';
    const modelId = process.env.BANANA_MODEL_ID || 'gemini-3-pro-image-preview';

    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predictLongRunning`;

    const requestBody: BananaRequest = {
      instances: [{ prompt: params.prompt }],
      parameters: {
        aspectRatio: params.aspectRatio,
        sampleCount: params.sampleCount,
        storageUri: outputStorageUri,
      },
    };

    logger.info(
      {
        prompt: params.prompt.substring(0, 50) + (params.prompt.length > 50 ? '...' : ''),
        aspectRatio: params.aspectRatio,
        apiMode: 'vertex',
      },
      'Starting Banana image generation (Vertex AI)',
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
          'Banana generation request failed',
        );

        const errorMessage = typeof errorJson === 'object' && errorJson.error?.message
          ? errorJson.error.message
          : errorText;

        throw new Error(`Banana API error (${response.status}): ${errorMessage}`);
      }

      const result = (await response.json()) as any;

      if (!result.name) {
        logger.error({ result }, 'No operation name in response');
        throw new Error('Invalid response: missing operation name');
      }

      logger.info('Banana generation request accepted');

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
        'Failed to start Banana generation',
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
  ): Promise<BananaOperation> {
    // Gemini API is synchronous, image already uploaded
    if (operationName.startsWith('gemini-sync-')) {
      if (onProgress) {
        await onProgress(1.0);
      }
      return {
        name: operationName,
        done: true,
      };
    }

    const startTime = Date.now();
    let pollInterval = INITIAL_POLL_INTERVAL_MS;

    logger.info('Polling for image generation results');

    while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
      try {
        const elapsedMs = Date.now() - startTime;

        // Image generation is typically faster than video
        const estimatedDuration = 60000; // 1 minute average
        const progress = Math.min(elapsedMs / estimatedDuration, 0.95);

        if (onProgress) {
          try {
            await onProgress(progress);
          } catch (error) {
            logger.warn({ error }, 'Progress callback failed');
          }
        }

        const operationStatus = await this.checkOperationStatus(operationName);
        if (operationStatus.done) {
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

        // Fallback: Check if any image files exist in the GCS prefix
        const files = await this.checkGcsFiles(gcsPrefix);

        if (files.length > 0) {
          if (onProgress) {
            try {
              await onProgress(1.0);
            } catch (error) {
              // Ignore progress callback errors
            }
          }

          logger.info({ elapsedMs, fileCount: files.length }, 'Image generation completed');

          return {
            name: operationName,
            done: true,
          };
        }

        await this.sleep(pollInterval);

        pollInterval = Math.min(pollInterval * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL_MS);
      } catch (error) {
        logger.error({ error, operationName, gcsPrefix }, 'Error polling GCS');
        throw error;
      }
    }

    logger.error({ duration: Date.now() - startTime }, 'Image generation timed out after 3 minutes');
    throw new Error('Image generation timed out after 3 minutes');
  }

  private async checkGcsFiles(prefix: string): Promise<string[]> {
    try {
      const files = await this.storageService.listImageFiles(prefix);
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
