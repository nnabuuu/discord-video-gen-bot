# Rate Limiting Spec Delta

## ADDED Requirements

### Requirement: User Request Rate Limiting
The system SHALL enforce a quota of 5 video generation requests per user per 24-hour rolling window using PostgreSQL queries instead of Redis.

#### Scenario: User within quota limit
- **WHEN** user has made fewer than 5 requests in the last 24 hours
- **THEN** query `video_requests` table for user's recent requests:
  ```sql
  SELECT COUNT(*) FROM video_requests
  WHERE user_id = $1
    AND created_at >= NOW() - INTERVAL '24 hours'
  ```
- **AND** if count < 5, return `{ allowed: true, remaining: 5 - count }`
- **AND** query execution completes within 50ms

#### Scenario: User exceeds quota limit
- **WHEN** user has made 5 or more requests in the last 24 hours
- **THEN** query database for user's requests and find oldest request timestamp
- **AND** calculate reset_time as (oldest_request_created_at + 24 hours)
- **AND** calculate wait_seconds as (reset_time - now)
- **AND** return `{ allowed: false, remaining: 0, resetTime, waitSeconds }`
- **AND** do not create new request in database

#### Scenario: Rolling window behavior
- **WHEN** user's oldest request was 23 hours ago
- **AND** user attempts new request
- **THEN** block request until 24 hours elapsed from oldest request
- **WHEN** oldest request ages past 24 hours
- **THEN** automatically exclude from count (rolling window)
- **AND** allow new request

#### Scenario: Query performance with large dataset
- **WHEN** `video_requests` table contains 1+ million records
- **AND** user has made 1000+ lifetime requests
- **THEN** query uses index on (user_id, created_at DESC)
- **AND** completes within 50ms
- **AND** only scans requests from last 24 hours

### Requirement: Rate Limit Data Persistence
The system SHALL use persisted request data for rate limiting, eliminating Redis dependency.

#### Scenario: Application restart
- **WHEN** application restarts
- **THEN** rate limit state is preserved from database
- **AND** users who were at quota limit remain blocked
- **AND** no requests are lost or double-counted

#### Scenario: Database query failure during rate check
- **WHEN** database is unreachable during rate limit check
- **THEN** log error with severity "error"
- **AND** return `{ allowed: true, remaining: 0 }` (fail open)
- **AND** log warning "Rate limiting degraded - database unavailable"
- **AND** allow request to proceed (graceful degradation)

### Requirement: Rate Limit Quota Inspection
The system SHALL provide methods to check remaining quota without consuming a request.

#### Scenario: Check remaining quota
- **WHEN** calling `getRemainingQuota(userId)`
- **THEN** query count of requests in last 24 hours
- **AND** return (5 - count) without modifying any data
- **AND** return 0 if count >= 5

#### Scenario: Check rate limit reset time
- **WHEN** user is at quota limit
- **AND** calling `getRateLimitInfo(userId)`
- **THEN** return object with:
  - `quotaUsed`: 5
  - `quotaLimit`: 5
  - `resetTime`: timestamp when oldest request expires
  - `resetIn`: human-readable string ("2h 15m")

### Requirement: Audit Trail for Rate Limiting
The system SHALL provide queryable audit trail for rate limit enforcement decisions.

#### Scenario: Rate limit rejection logging
- **WHEN** user is blocked due to rate limit
- **THEN** log event with level "warn"
- **AND** include fields: user_id, request_count, oldest_request_time, reset_time
- **AND** include user's recent request timestamps for debugging

#### Scenario: Historical rate limit analysis
- **WHEN** querying users who hit rate limits
- **THEN** query requests grouped by user_id
- **AND** filter for users with 5+ requests in any 24-hour window
- **AND** return user_id, total_requests, first_limited_at timestamp

### Requirement: Time Zone Handling
The system SHALL handle all rate limit calculations in UTC to avoid time zone ambiguity.

#### Scenario: Timestamp storage
- **WHEN** storing request timestamps
- **THEN** use PostgreSQL `TIMESTAMPTZ` type
- **AND** store all timestamps in UTC
- **AND** calculate 24-hour windows using UTC time

#### Scenario: Cross-timezone user requests
- **WHEN** user makes requests from different time zones
- **THEN** rate limit window is consistent (24 hours from first request)
- **AND** not affected by daylight saving time changes
- **AND** not affected by user's local time zone
