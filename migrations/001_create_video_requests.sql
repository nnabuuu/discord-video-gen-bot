-- Migration: Create video_requests table
-- Description: Create table for tracking all video generation requests with full lifecycle

CREATE TABLE IF NOT EXISTS video_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Discord context
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,

  -- Request parameters
  prompt TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds IN (4, 6, 8)),
  aspect_ratio TEXT NOT NULL CHECK (aspect_ratio IN ('16:9', '9:16')),
  resolution TEXT NOT NULL CHECK (resolution IN ('720p', '1080p')),
  generate_audio BOOLEAN NOT NULL DEFAULT true,

  -- Lifecycle tracking
  status TEXT NOT NULL CHECK (status IN ('pending', 'generating', 'completed', 'failed', 'timeout')),
  operation_name TEXT,

  -- Timing metrics
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Results
  gcs_prefix TEXT,
  video_urls TEXT[],
  error_message TEXT
);

-- Add comment explaining the table
COMMENT ON TABLE video_requests IS 'Stores all video generation requests with full lifecycle tracking';
