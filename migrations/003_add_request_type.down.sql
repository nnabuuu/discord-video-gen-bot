-- Rollback: Remove request_type column

DROP INDEX IF EXISTS idx_video_requests_user_type_created;
ALTER TABLE video_requests DROP COLUMN IF EXISTS request_type;
