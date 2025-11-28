-- Migration: Create user_api_keys table
-- Description: Store user API key bindings for /banana command

CREATE TABLE IF NOT EXISTS user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Discord user binding
  user_id VARCHAR(32) NOT NULL UNIQUE,

  -- Connection code (temporary, cleared after API key is set)
  connection_code VARCHAR(36) UNIQUE,
  code_expires_at TIMESTAMPTZ,

  -- Encrypted API key
  api_key_encrypted TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for connection code lookups (partial index for non-null codes)
CREATE INDEX IF NOT EXISTS idx_user_api_keys_code
ON user_api_keys(connection_code)
WHERE connection_code IS NOT NULL;

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_user_api_keys_user
ON user_api_keys(user_id);

COMMENT ON TABLE user_api_keys IS 'Stores user Gemini API key bindings for /banana command';
COMMENT ON COLUMN user_api_keys.connection_code IS 'Temporary code for web-based API key submission, expires after 10 minutes';
COMMENT ON COLUMN user_api_keys.api_key_encrypted IS 'AES-256-GCM encrypted Gemini API key';
