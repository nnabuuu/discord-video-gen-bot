import { Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { logger } from '../common/logger';

/**
 * Qwen-Image (DashScope / Bailian) text-to-image service.
 *
 * Design goal:
 * - Follow BananaService pattern: generate -> upload to GCS -> return a synthetic operation name
 * - Keep Discord command logic unchanged as much as possible
 */
@Injectable()
export class QwenImageService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly storageService: StorageService) {
    this.baseUrl = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com';
    this.apiKey = process.env.DASHSCOPE_API_KEY || '';
    this.model = process.env.QWEN_IMAGE_MODEL || 'qwen-image-plus';

    if (!this.apiKey) {
      throw new Error('DASHSCOPE_API_KEY is required');
    }

    logger.info(
      { baseUrl: this.baseUrl, model: this.model },
      'QwenImageService initialized',
    );
  }

  /**
   * Generate an image and upload it to GCS immediately (sync flow).
   * Returns a synthetic operation name like "qwen-sync-<timestamp>".
   */
  async startGeneration(
    params: { prompt: string; aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'; sampleCount: number },
    outputStorageUri: string,
  ): Promise<string> {
    const size = this.mapAspectRatioToSize(params.aspectRatio);

    logger.info(
      {
        prompt: params.prompt.substring(0, 50) + (params.prompt.length > 50 ? '...' : ''),
        aspectRatio: params.aspectRatio,
        size,
        model: this.model,
      },
      'Starting Qwen-Image generation (DashScope)',
    );

    const endpoint = `${this.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`;

    const requestBody = {
      model: this.model,
      input: {
        messages: [
          {
            role: 'user',
            content: [{ text: params.prompt }],
          },
        ],
      },
      parameters: {
        size, // e.g. "1328*1328"
        prompt_extend: true,
        watermark: false,
      },
    };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      logger.error(
        { status: resp.status, statusText: resp.statusText, errorText },
        'Qwen-Image request failed',
      );
      throw new Error(`Qwen-Image API error (${resp.status}): ${errorText}`);
    }

    const result = await resp.json();
    const imageUrl = this.extractImageUrl(result);

    if (!imageUrl) {
      logger.error(
        { response: JSON.stringify(result).substring(0, 1500) },
        'No image URL found in Qwen-Image response',
      );
      throw new Error('No image URL found in Qwen-Image response');
    }

    // Download the image from the signed URL and upload to GCS
    const imageBuffer = await this.downloadToBuffer(imageUrl);

    // outputStorageUri looks like: gs://<bucket>/<prefix>
    const prefix = outputStorageUri.replace(`gs://${process.env.OUTPUT_BUCKET}/`, '');
    const fileName = `${prefix}image_0.png`;

    await this.storageService.uploadBuffer(imageBuffer, fileName, 'image/png');

    logger.info({ fileName }, 'Qwen-Image uploaded to GCS');

    // Return a synthetic operation name (sync style like Banana gemini mode)
    return `qwen-sync-${Date.now()}`;
  }

  /**
   * Keep the same signature as BananaService.pollOperation for compatibility.
   * For qwen-sync-* operations, generation already completed and image was uploaded.
   */
  async pollOperation(
    operationName: string,
    _gcsPrefix: string,
    onProgress?: (progress: number) => Promise<void>,
  ): Promise<{ name: string; done: boolean }> {
    if (operationName.startsWith('qwen-sync-')) {
      if (onProgress) await onProgress(1.0);
      return { name: operationName, done: true };
    }

    // If you later switch Qwen-Image to an async endpoint, implement polling here.
    if (onProgress) await onProgress(1.0);
    return { name: operationName, done: true };
  }

  private extractImageUrl(result: any): string | null {
    // Typical path:
    // result.output.choices[0].message.content[0].image
    try {
      const image = result?.output?.choices?.[0]?.message?.content?.[0]?.image;
      return typeof image === 'string' && image.length > 0 ? image : null;
    } catch {
      return null;
    }
  }

  private async downloadToBuffer(url: string): Promise<Buffer> {
    const r = await fetch(url);
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Failed to download image: ${r.status} ${t}`);
    }
    const arr = await r.arrayBuffer();
    return Buffer.from(arr);
  }

  private mapAspectRatioToSize(
    ratio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4',
  ): string {
    // You can tweak sizes later. Keep it simple & stable.
    switch (ratio) {
      case '1:1':
        return '1328*1328';
      case '16:9':
        return '1664*928';
      case '9:16':
        return '928*1664';
      case '4:3':
        return '1472*1104';
      case '3:4':
        return '1104*1472';
      default:
        return '1328*1328';
    }
  }
}