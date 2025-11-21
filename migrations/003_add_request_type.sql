-- Add request_type column to distinguish veo vs banana requests
-- Default to 'veo' for existing records

ALTER TABLE video_requests
ADD COLUMN IF NOT EXISTS request_type VARCHAR(20) DEFAULT 'veo' NOT NULL;

-- Add index for rate limiting queries by type
CREATE INDEX IF NOT EXISTS idx_video_requests_user_type_created
ON video_requests (user_id, request_type, created_at DESC);

COMMENT ON COLUMN video_requests.request_type IS 'Type of generation request: veo (video) or banana (image)';
