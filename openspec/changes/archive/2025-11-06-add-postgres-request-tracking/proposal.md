# Add PostgreSQL Request Tracking and Database-Backed Rate Limiting

## Why
Currently, video generation requests are ephemeral - no historical data is persisted beyond in-memory or Redis rate limiting entries. We need to track all user requests with full lifecycle data (pending → generating → completed/failed/timeout) for analytics, compliance, content moderation, and data-driven improvements. Additionally, rate limiting relies on Redis or volatile in-memory storage, which lacks persistence and auditability.

## What Changes
- Add **PostgreSQL** as the primary persistence layer using **Slonik** client library
- Create comprehensive **request tracking** table storing all video generation attempts with timing data
- Implement **database-backed rate limiting** replacing Redis/in-memory implementation
- Set up **manual SQL migrations** for schema management with psql
- Track full request lifecycle: `pending` → `generating` → `completed` / `failed` / `timeout`
- Store timing metrics: request time, generation start time, completion time, duration
- Capture all request parameters: prompt, duration, aspect ratio, resolution, audio settings
- Store operation results: operation name, GCS URIs, public URLs, error details
- **BREAKING**: Removes Redis dependency for rate limiting (becomes optional for caching future features)

## Impact
- **Affected specs**:
  - `database-integration` (NEW capability)
  - `request-tracking` (NEW capability)
  - `rate-limiting` (MODIFIED - move from Redis to PostgreSQL)
  - `sql-migrations` (NEW capability)

- **Affected code**:
  - `src/database/` (NEW module)
  - `src/rate-limit/rate-limit.service.ts` (MODIFIED - use database queries)
  - `src/discord/commands/veo.command.ts` (MODIFIED - add request tracking)
  - `src/veo/veo.service.ts` (MODIFIED - update status transitions)
  - `package.json` (ADD slonik, MODIFY ioredis to dev dependency)
  - `migrations/` (NEW - plain SQL migration files)
  - `.env.example` (ADD database configuration)

- **Migration path**:
  - Existing deployments need PostgreSQL connection string
  - Rate limit data from Redis/memory is NOT migrated (fresh 24-hour window)
  - Graceful fallback if database unavailable (logs warning, continues operation)

## Dependencies
- PostgreSQL 14+ database instance
- psql CLI for migration application
- Database connection pooling via Slonik

## Success Criteria
- All video generation requests persisted with full lifecycle
- Rate limiting works correctly using database queries
- Query performance <50ms for rate limit checks
- Historical request data queryable for analytics
- Zero data loss during normal operation
