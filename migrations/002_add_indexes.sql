-- Migration: Add indexes for performance
-- Description: Add indexes for rate limiting, status queries, and guild analytics

-- Index for rate limiting queries (user_id + created_at)
CREATE INDEX IF NOT EXISTS idx_video_requests_user_created
  ON video_requests (user_id, created_at DESC);

-- Index for status-based queries
CREATE INDEX IF NOT EXISTS idx_video_requests_status_created
  ON video_requests (status, created_at DESC);

-- Index for guild-level analytics
CREATE INDEX IF NOT EXISTS idx_video_requests_guild_created
  ON video_requests (guild_id, created_at DESC);
