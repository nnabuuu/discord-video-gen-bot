## Context

Users are limited to 5 image requests per day on the `/banana` command. Power users want to generate more images and are willing to provide their own Gemini API keys. The external service at app.sightai.io will handle the API key submission UI, while the Discord bot manages code generation and key storage.

## Goals / Non-Goals

**Goals:**
- Allow users to bypass `/banana` rate limits by providing their own Gemini API key
- Secure binding of API keys to Discord users via unique codes
- Simple user experience: one command to connect, one to disconnect

**Non-Goals:**
- Managing billing or usage tracking for user-provided keys
- Supporting multiple API keys per user

## Decisions

### Connection Code Format
- **Decision**: Use UUID v4 for connection codes
- **Why**: Cryptographically random, no collisions, URL-safe

### Code Expiration
- **Decision**: Codes expire after 10 minutes
- **Why**: Balances security (short-lived) with user convenience

### API Key Storage
- **Decision**: Store API keys encrypted using AES-256-GCM with environment variable key
- **Why**: Protects keys at rest; encryption key separate from database
- **Alternative considered**: Plain text storage - rejected for security reasons

### Rate Limit Fallback (Free Credits First)
- **Decision**: Use free credits first (5/day), then fall back to user's API key when exhausted
- **Why**: Users get free quota first; own key is a fallback for power users
- **Alternative considered**: Always use own key when available - rejected as users should benefit from free credits

### Web Interface & API Endpoints
- **Decision**: Serve static web page and API endpoints from this project (same NestJS app)
- **Why**: Simpler - single deployment, no extra infrastructure needed
- **Web Page**: `GET /connect?code=<code>` - HTML page for API key management
- **API Endpoints**:
  - `GET /api/connect?code=<code>` - Get status (masked key, connected at timestamp)
  - `POST /api/connect` with `{ code, apiKey }` - Bind new API key
  - `DELETE /api/connect?code=<code>` - Disconnect API key
- **Configuration**: `BASE_URL` env var for production URL (default: `http://localhost:3000`)

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| API key exposure in database | AES-256-GCM encryption, separate encryption key |
| Connection code hijacking | Short expiration (10 min), UUID randomness |
| Invalid/revoked user API keys | Graceful error handling, suggest reconnect |
| External service unavailable | Connection code still generated, user can retry |

## Data Flow

**Connection Flow:**
```
1. User runs /api-key connect
2. Bot generates UUID code, stores in DB with user_id, returns URL
3. User opens URL (served by this bot): /connect?code=xxx
4. Web page calls GET /api/connect?code=xxx → shows current status
5. User can:
   - Submit new key → POST /api/connect { code, apiKey }
   - Disconnect key → DELETE /api/connect?code=xxx
6. User runs /api-key status → shows masked key: "AIza...xxxx"
```

**Generation Flow (Free Credits First):**
```
1. User runs /banana
2. Bot checks rate limit (count requests in last 24h)
3. If remaining > 0: use default API key (free credits)
   - Footer shows: "X remaining today"
4. If remaining = 0 AND user has bound key: use user's API key
   - Footer shows: "Using your API key (free credits exhausted)"
5. If remaining = 0 AND no bound key: reject with rate limit message
```

## Database Schema

```sql
CREATE TABLE user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(32) NOT NULL UNIQUE,
  connection_code VARCHAR(36) UNIQUE,
  api_key_encrypted TEXT,
  code_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_api_keys_code ON user_api_keys(connection_code) WHERE connection_code IS NOT NULL;
CREATE INDEX idx_user_api_keys_user ON user_api_keys(user_id);
```

## Open Questions

- Should we validate the API key by making a test call before storing?
- Should users be notified when their API key fails during generation?
