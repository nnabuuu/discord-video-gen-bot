-- Migration: Relax constraints for banana (image) requests
-- Description: Allow NULL values and additional aspect ratios for image generation

-- Drop existing constraints
ALTER TABLE video_requests DROP CONSTRAINT IF EXISTS video_requests_duration_seconds_check;
ALTER TABLE video_requests DROP CONSTRAINT IF EXISTS video_requests_aspect_ratio_check;
ALTER TABLE video_requests DROP CONSTRAINT IF EXISTS video_requests_resolution_check;

-- Make columns nullable for image requests
ALTER TABLE video_requests ALTER COLUMN duration_seconds DROP NOT NULL;
ALTER TABLE video_requests ALTER COLUMN resolution DROP NOT NULL;
ALTER TABLE video_requests ALTER COLUMN generate_audio DROP NOT NULL;

-- Add new constraints that allow image aspect ratios and NULL values
ALTER TABLE video_requests ADD CONSTRAINT video_requests_duration_seconds_check
  CHECK (duration_seconds IS NULL OR duration_seconds IN (4, 6, 8));

ALTER TABLE video_requests ADD CONSTRAINT video_requests_aspect_ratio_check
  CHECK (aspect_ratio IN ('16:9', '9:16', '1:1', '4:3', '3:4'));

ALTER TABLE video_requests ADD CONSTRAINT video_requests_resolution_check
  CHECK (resolution IS NULL OR resolution IN ('720p', '1080p'));
