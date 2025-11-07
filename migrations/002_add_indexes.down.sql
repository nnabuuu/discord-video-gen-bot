-- Rollback: Drop indexes
DROP INDEX IF EXISTS idx_video_requests_user_created;
DROP INDEX IF EXISTS idx_video_requests_status_created;
DROP INDEX IF EXISTS idx_video_requests_guild_created;
