import { Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { logger } from '../common/logger';

const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const INITIAL_POLL_INTERVAL_MS = 1000;
const MAX_POLL_INTERVAL_MS = 10000;
const BACKOFF_MULTIPLIER = 1.5;

type WanTaskStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

@Injectable()
export class WanService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly modelId: string;

  constructor(private readonly storageService: StorageService) {
    this.baseUrl = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com';
    this.apiKey = process.env.DASHSCOPE_API_KEY || '';
    this.modelId = process.env.WAN_MODEL_ID || 'wan2.5-t2v-preview';

    if (!this.apiKey) throw new Error('DASHSCOPE_API_KEY is required');
    logger.info({ baseUrl: this.baseUrl, modelId: this.modelId }, 'WanService initialized');
  }

  async startGeneration(params: {
    prompt: string;
    durationSeconds: 4 | 6 | 8;
    aspectRatio: '16:9' | '9:16';
    resolution: '720p' | '1080p'; // keep same as VeoCommand
    generateAudio: boolean;
    sampleCount: number;
  }): Promise<string> {
    const endpoint = `${this.baseUrl}/api/v1/services/aigc/video-generation/video-synthesis`;

    const size = this.mapToWanSize(params.aspectRatio, params.resolution);

    logger.info(
      {
        prompt: params.prompt.substring(0, 50) + (params.prompt.length > 50 ? '...' : ''),
        duration: params.durationSeconds,
        size,
        audio: params.generateAudio,
        modelId: this.modelId,
      },
      'Starting Wan video generation (DashScope)',
    );

    const requestBody = {
      model: this.modelId,
      input: { prompt: params.prompt },
      parameters: {
        size,
        duration: params.durationSeconds,
        prompt_extend: true,
        audio: params.generateAudio,
      },
    };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      logger.error({ status: resp.status, statusText: resp.statusText, errorText }, 'Wan request failed');
      throw new Error(`Wan API error (${resp.status}): ${errorText}`);
    }

    const json = await resp.json();
    const taskId = json?.output?.task_id;
    if (!taskId) {
      logger.error({ json: JSON.stringify(json).substring(0, 1000) }, 'No task_id in Wan response');
      throw new Error('Invalid Wan response: missing task_id');
    }

    return taskId;
  }

  async pollOperation(
    taskId: string,
    onProgress?: (progress: number) => Promise<void>,
  ): Promise<{ done: boolean; videoUrl?: string; actualPrompt?: string }> {
    const startTime = Date.now();
    let pollInterval = INITIAL_POLL_INTERVAL_MS;

    while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
      const elapsedMs = Date.now() - startTime;

      // Estimated progress only (DashScope does not provide %)
      const estimatedDuration = 180000; // 3 minutes avg
      const progress = Math.min(elapsedMs / estimatedDuration, 0.95);

      if (onProgress) {
        try { await onProgress(progress); } catch {}
      }

      const res = await this.getTask(taskId);
      const st: WanTaskStatus = res.task_status;

      if (st === 'SUCCEEDED') {
        if (onProgress) {
          try { await onProgress(1.0); } catch {}
        }
        if (!res.video_url) throw new Error('Wan task succeeded but video_url missing');
        return { done: true, videoUrl: res.video_url, actualPrompt: res.actual_prompt };
      }

      if (st === 'FAILED') {
        throw new Error('Wan video generation failed');
      }

      await new Promise((r) => setTimeout(r, pollInterval));
      pollInterval = Math.min(pollInterval * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL_MS);
    }

    throw new Error('Generation timed out after 5 minutes');
  }

  /**
   * Download mp4 from DashScope signed OSS URL.
   */
  async downloadVideoToBuffer(videoUrl: string): Promise<Buffer> {
    const r = await fetch(videoUrl);
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Failed to download video: ${r.status} ${t}`);
    }
    const arr = await r.arrayBuffer();
    return Buffer.from(arr);
  }

  /**
   * Upload mp4 to GCS using existing StorageService (stable URL).
   */
  async uploadVideoToGcs(
    buf: Buffer,
    outputStorageUri: string,
    fileName = 'video_0.mp4',
  ): Promise<string> {
    const prefix = outputStorageUri.replace(`gs://${process.env.OUTPUT_BUCKET}/`, '');
    const objectName = `${prefix}${fileName}`;
    await this.storageService.uploadBuffer(buf, objectName, 'video/mp4');
    return objectName;
  }

  private async getTask(taskId: string): Promise<{ task_status: WanTaskStatus; video_url?: string; actual_prompt?: string }> {
    const url = `${this.baseUrl}/api/v1/tasks/${taskId}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Failed to query task: ${resp.status} ${t}`);
    }

    const json = await resp.json();
    const output = json?.output;
    return {
      task_status: output?.task_status,
      video_url: output?.video_url,
      actual_prompt: output?.actual_prompt,
    };
  }

  private mapToWanSize(aspectRatio: '16:9' | '9:16', resolution: '720p' | '1080p'): string {
    // Keep it simple and deterministic
    if (aspectRatio === '16:9') return resolution === '1080p' ? '1280*720' : '832*480';
    return resolution === '1080p' ? '720*1280' : '480*832';
  }
}