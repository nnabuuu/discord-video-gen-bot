## MODIFIED Requirements

### Requirement: User Request Rate Limiting
The system SHALL enforce a quota of 5 image generation requests per user per 24-hour rolling window for the `/banana` command using PostgreSQL queries. When quota is exhausted, users with bound Gemini API keys can continue using their own key.

#### Scenario: User within quota limit
- **WHEN** user has made fewer than 5 requests in the last 24 hours
- **THEN** query `video_requests` table for user's recent requests:
  ```sql
  SELECT COUNT(*) FROM video_requests
  WHERE user_id = $1
    AND created_at >= NOW() - INTERVAL '24 hours'
  ```
- **AND** if count < 5, return `{ allowed: true, remaining: 5 - count, usingOwnKey: false }`
- **AND** use default API key (free credits)
- **AND** query execution completes within 50ms

#### Scenario: User exceeds quota without bound API key
- **WHEN** user has made 5 or more requests in the last 24 hours
- **AND** user does NOT have a bound API key
- **THEN** query database for user's requests and find oldest request timestamp
- **AND** calculate reset_time as (oldest_request_created_at + 24 hours)
- **AND** calculate wait_seconds as (reset_time - now)
- **AND** return `{ allowed: false, remaining: 0, resetTime, waitSeconds }`
- **AND** do not create new request in database

#### Scenario: User exceeds quota with bound API key
- **WHEN** user has made 5 or more requests in the last 24 hours
- **AND** user has a valid API key bound to their account
- **THEN** return `{ allowed: true, remaining: 0, usingOwnKey: true }`
- **AND** use user's bound API key for this request
- **AND** reply message indicates "Using your own API key"

#### Scenario: Rolling window behavior
- **WHEN** user's oldest request was 23 hours ago
- **AND** user attempts new request
- **THEN** block request until 24 hours elapsed from oldest request (if no bound key)
- **OR** allow request using bound API key (if available)
- **WHEN** oldest request ages past 24 hours
- **THEN** automatically exclude from count (rolling window)
- **AND** resume using free credits

#### Scenario: Query performance with large dataset
- **WHEN** `video_requests` table contains 1+ million records
- **AND** user has made 1000+ lifetime requests
- **THEN** query uses index on (user_id, created_at DESC)
- **AND** completes within 50ms
- **AND** only scans requests from last 24 hours
