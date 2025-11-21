-- Rollback: Restore strict constraints (will fail if NULL values exist)

ALTER TABLE video_requests DROP CONSTRAINT IF EXISTS video_requests_duration_seconds_check;
ALTER TABLE video_requests DROP CONSTRAINT IF EXISTS video_requests_aspect_ratio_check;
ALTER TABLE video_requests DROP CONSTRAINT IF EXISTS video_requests_resolution_check;

ALTER TABLE video_requests ALTER COLUMN duration_seconds SET NOT NULL;
ALTER TABLE video_requests ALTER COLUMN resolution SET NOT NULL;
ALTER TABLE video_requests ALTER COLUMN generate_audio SET NOT NULL;

ALTER TABLE video_requests ADD CONSTRAINT video_requests_duration_seconds_check
  CHECK (duration_seconds IN (4, 6, 8));

ALTER TABLE video_requests ADD CONSTRAINT video_requests_aspect_ratio_check
  CHECK (aspect_ratio IN ('16:9', '9:16'));

ALTER TABLE video_requests ADD CONSTRAINT video_requests_resolution_check
  CHECK (resolution IN ('720p', '1080p'));
