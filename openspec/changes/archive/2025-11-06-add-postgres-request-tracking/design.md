# Design: PostgreSQL Request Tracking

## Context
The Discord video generation bot currently has no persistent storage beyond ephemeral rate limiting in Redis or in-memory maps. As the service matures, we need:
- Historical analytics on request patterns, prompt trends, and failure rates
- Compliance and content moderation audit trails
- Data-driven insights for improving generation quality
- Persistent, queryable rate limiting that survives restarts

**Stakeholders**: Developers, data analysts, compliance teams

**Constraints**:
- Must not degrade request latency (target: <50ms for database operations)
- Must handle database unavailability gracefully (log and continue)
- Must integrate with existing NestJS architecture
- Schema management via plain SQL migrations (simplicity, no external dependencies)

## Goals / Non-Goals

**Goals**:
- Persist all video generation requests with full lifecycle tracking
- Move rate limiting to database for auditability and persistence
- Enable historical analytics queries
- Track timing metrics for performance analysis
- Store generation parameters and results for debugging

**Non-Goals**:
- Real-time dashboards (out of scope - future work)
- Video file storage in database (stored in GCS)
- User authentication/authorization (uses Discord IDs)
- Database backups/replication strategy (infrastructure concern)
- GraphQL API for database queries (direct SQL queries sufficient for now)

## Decisions

### Decision 1: Slonik as PostgreSQL Client
**What**: Use Slonik instead of TypeORM, Prisma, or node-postgres

**Why**:
- Raw SQL control with type safety via `sql` tagged templates
- Excellent connection pooling and error handling
- Minimal overhead compared to ORMs
- Team familiarity (mentioned in requirements)
- Lightweight - no schema generation complexity

**Alternatives considered**:
- **TypeORM**: Too heavyweight, decorators add complexity, migrations harder to manage
- **Prisma**: Schema-first approach adds unnecessary abstraction for simple queries
- **node-postgres**: Less type-safe, requires manual pooling, more boilerplate

### Decision 2: Manual SQL Migrations with psql
**What**: Use plain SQL migration files managed with psql commands, no migration framework

**Why**:
- Simplicity - no external dependencies or tools required
- Direct control over SQL execution
- Easy to understand and debug
- Portable - works with any PostgreSQL client
- Version-controlled in `migrations/` directory
- Idempotent with `IF NOT EXISTS` / `IF EXISTS` clauses

**Configuration**:
- Migration files numbered: `001_*.sql`, `002_*.sql`, etc.
- Rollback files: `001_*.down.sql`, `002_*.down.sql`
- npm scripts wrap psql commands for convenience
- Docker Compose auto-applies migrations on first start

### Decision 3: Request Status State Machine
**States**: `pending` → `generating` → `completed` | `failed` | `timeout`

**Transitions**:
1. **pending**: Request validated, rate limit passed, stored in DB
2. **generating**: Vertex AI operation started, polling in progress
3. **completed**: Videos generated, URLs stored
4. **failed**: Error during generation (API error, content safety)
5. **timeout**: Operation exceeded 5-minute polling timeout

**Why**: Clear lifecycle tracking for debugging and analytics

### Decision 4: Single `video_requests` Table
**What**: Denormalized single-table design instead of normalized schema

**Schema**:
```sql
CREATE TABLE video_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Discord context
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,

  -- Request parameters
  prompt TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds IN (4, 6, 8)),
  aspect_ratio TEXT NOT NULL CHECK (aspect_ratio IN ('16:9', '9:16')),
  resolution TEXT NOT NULL CHECK (resolution IN ('720p', '1080p')),
  generate_audio BOOLEAN NOT NULL DEFAULT true,

  -- Lifecycle tracking
  status TEXT NOT NULL CHECK (status IN ('pending', 'generating', 'completed', 'failed', 'timeout')),
  operation_name TEXT,

  -- Timing metrics
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Results
  gcs_prefix TEXT,
  video_urls TEXT[],
  error_message TEXT,

  -- Indexes for common queries
  INDEX idx_user_created (user_id, created_at DESC),
  INDEX idx_status_created (status, created_at DESC),
  INDEX idx_guild_created (guild_id, created_at DESC)
);
```

**Why**:
- Simple queries for rate limiting (single table scan)
- Easy analytics aggregations
- No joins needed for request details
- JSONB not needed - schema is stable

**Trade-off**: Slightly redundant data (Discord context repeated) but worth it for query simplicity

### Decision 5: Rate Limiting via Window Function
**What**: Use PostgreSQL window function instead of separate rate_limit table

**Query approach**:
```sql
SELECT COUNT(*) OVER (
  PARTITION BY user_id
  ORDER BY created_at DESC
  RANGE BETWEEN INTERVAL '24 hours' PRECEDING AND CURRENT ROW
) as request_count
FROM video_requests
WHERE user_id = $1
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 1;
```

**Why**:
- Reuses existing request data (no separate table)
- Accurate rolling window (not fixed daily reset)
- Auditability - see which requests counted against quota
- Simpler schema management

**Performance**: Index on `(user_id, created_at DESC)` keeps query <20ms

**Alternative considered**:
- Separate `rate_limits` table: More normalized but adds join complexity and update contention

### Decision 6: Graceful Degradation
**What**: If database unavailable, log error but continue operation (no request tracking)

**Why**:
- Video generation is primary function
- Database is enhancement, not blocker
- Better UX than failing requests

**Implementation**:
- Try-catch around all database operations
- Log errors with context
- Return "allowed" for rate limits if DB down (trust Discord user, log warning)

## Risks / Trade-offs

### Risk 1: Database as Single Point of Failure
**Risk**: PostgreSQL downtime blocks rate limiting

**Mitigation**:
- Graceful degradation (allow requests if DB down, log warnings)
- Connection pooling with retry logic
- Health check endpoint monitors database connectivity
- Consider Redis fallback for rate limiting if DB consistently unavailable (future enhancement)

### Risk 2: Query Performance Degradation
**Risk**: As table grows, rate limit queries slow down

**Mitigation**:
- Strategic indexes on `(user_id, created_at DESC)`
- Partition table by month if >10M rows (future consideration)
- Query optimization: Use `LIMIT 1` to short-circuit after first result
- Monitor query performance in logs

**Benchmark target**: <50ms for rate limit check at 1M rows

### Risk 3: Migration Complexity
**Risk**: Existing deployments need database setup

**Mitigation**:
- Clear documentation in README for database setup
- Environment variable validation at startup (fail fast if missing)
- Example Docker Compose for local development
- Migration scripts automated via npm commands

### Risk 4: Time Zone Handling
**Risk**: 24-hour window ambiguous across time zones

**Mitigation**:
- Store all timestamps as `TIMESTAMPTZ` (UTC)
- Calculate windows in UTC (no daylight savings issues)
- Document behavior clearly in rate limiting spec

## Migration Plan

### Phase 1: Database Setup (No Code Changes)
1. Add `DATABASE_URL` to `.env.example`
2. Create `migrations/` directory structure
3. Write initial SQL migration for `video_requests` table
4. Create rollback migration files
5. Add npm scripts for migration management
6. Test migration locally with Docker Compose

### Phase 2: Database Module (New Code)
1. Add Slonik dependency (`npm install slonik`)
2. Create `src/database/` module with NestJS integration
3. Implement connection pooling service
4. Add health check for database connectivity
5. Write unit tests for database module

### Phase 3: Request Tracking Integration
1. Create `RequestTrackingService` in `src/database/`
2. Modify `veo.command.ts` to create request on command invoke
3. Update status to `generating` when operation starts
4. Update status to `completed/failed/timeout` after polling
5. Store timing metrics and results

### Phase 4: Rate Limiting Migration (Breaking Change)
1. Backup existing rate limit logic (comment out)
2. Implement database-backed rate limiting in `RateLimitService`
3. Test rolling window behavior matches previous implementation
4. Update tests to use database queries
5. Remove Redis dependency from production code (move to `devDependencies`)

### Phase 5: Documentation and Deployment
1. Update README with database setup instructions
2. Document environment variables
3. Create Docker Compose example for local dev
4. Update deployment guide for Cloud Run (Cloud SQL)
5. Add troubleshooting section for database issues

### Rollback Plan
- Keep Redis code commented for 1 release
- Feature flag: `ENABLE_DATABASE_TRACKING=true|false`
- If critical issues, disable database and revert to Redis
- Database is additive (can disable without losing core functionality)

## Open Questions
1. **Should we add a GraphQL API for analytics queries?**
   - Decision: No initially, direct SQL queries sufficient for now

2. **Retention policy for old requests?**
   - Decision: Manual cleanup initially, add TTL policy after 6 months of data

3. **Should we track partial generation progress (% complete)?**
   - Decision: No, progress is estimated (not real progress from API)

4. **Replicate data to BigQuery for long-term analytics?**
   - Decision: Future work, out of scope for this change
