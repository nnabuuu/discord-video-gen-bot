export enum VideoRequestStatus {
  PENDING = 'pending',
  GENERATING = 'generating',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
}

export enum RequestType {
  VEO = 'veo',
  BANANA = 'banana',
}

export interface VideoRequestRow {
  id: string;
  user_id: string;
  guild_id: string;
  channel_id: string;
  prompt: string;
  duration_seconds: 4 | 6 | 8 | null;
  aspect_ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  resolution: '720p' | '1080p' | null;
  generate_audio: boolean | null;
  status: VideoRequestStatus;
  request_type: RequestType;
  operation_name: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  duration_ms: number | null;
  gcs_prefix: string | null;
  video_urls: string[] | null;
  error_message: string | null;
}

export interface CreateVideoRequestInput {
  user_id: string;
  guild_id: string;
  channel_id: string;
  prompt: string;
  request_type: RequestType;
  duration_seconds?: 4 | 6 | 8;
  aspect_ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  resolution?: '720p' | '1080p';
  generate_audio?: boolean;
}

export interface UpdateVideoRequestInput {
  id: string;
  status?: VideoRequestStatus;
  operation_name?: string;
  started_at?: Date;
  completed_at?: Date;
  duration_ms?: number;
  gcs_prefix?: string;
  video_urls?: string[];
  error_message?: string;
}
