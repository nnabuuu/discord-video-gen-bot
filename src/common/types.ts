export interface VeoGenerationParams {
  prompt: string;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: '16:9' | '9:16';
  resolution: '720p' | '1080p';
  generateAudio: boolean;
  sampleCount: number;
}

export interface VeoRequest {
  instances: Array<{ prompt: string }>;
  parameters: {
    durationSeconds: number;
    aspectRatio: string;
    resolution: string;
    generateAudio: boolean;
    sampleCount: number;
    storageUri: string;
  };
}

export interface VeoOperation {
  name: string;
  done?: boolean;
  error?: {
    code: number;
    message: string;
    details?: any[];
  };
  metadata?: any;
  response?: any;
}

export interface GenerationContext {
  userId: string;
  guildId: string;
  channelId: string;
  requestId: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime?: number;
  waitSeconds?: number;
}

export interface VideoResult {
  publicUrl: string;
  objectName: string;
}

// Banana (nano-banana / gemini-3-pro-image-preview) types
export interface BananaGenerationParams {
  prompt: string;
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  sampleCount: number;
}

export interface BananaRequest {
  instances: Array<{ prompt: string }>;
  parameters: {
    aspectRatio: string;
    sampleCount: number;
    storageUri: string;
  };
}

export interface BananaOperation {
  name: string;
  done?: boolean;
  error?: {
    code: number;
    message: string;
    details?: any[];
  };
  metadata?: any;
  response?: any;
}
