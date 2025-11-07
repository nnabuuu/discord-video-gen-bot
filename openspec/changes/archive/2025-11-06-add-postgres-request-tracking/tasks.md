# Implementation Tasks

## 1. Project Setup and Dependencies

- [ ] 1.1 Install Slonik and PostgreSQL dependencies
  ```bash
  npm install slonik
  npm install --save-dev @types/pg
  ```
- [ ] 1.2 Move ioredis to devDependencies
  ```bash
  npm install --save-dev ioredis
  ```
- [ ] 1.3 Add database environment variables to `.env.example`
  - `DATABASE_URL`
  - `DATABASE_MAX_CONNECTIONS` (optional, default: 10)
  - `REQUEST_RETENTION_DAYS` (optional)
- [ ] 1.4 Create Docker Compose file for local PostgreSQL
  - PostgreSQL 14+ container
  - Volume mounts for data persistence
  - Auto-apply migrations on first startup

## 2. SQL Migration Setup

- [ ] 2.1 Create migrations directory structure
  ```bash
  mkdir -p migrations
  ```
- [ ] 2.2 Create migration: `001_create_video_requests.sql`
  - All columns as per design.md schema
  - CHECK constraints for enums
  - UUID primary key with default
  - Use IF NOT EXISTS for idempotency
- [ ] 2.3 Create rollback: `001_create_video_requests.down.sql`
  ```sql
  DROP TABLE IF EXISTS video_requests;
  ```
- [ ] 2.4 Create migration: `002_add_indexes.sql`
  - Index on (user_id, created_at DESC)
  - Index on (status, created_at DESC)
  - Index on (guild_id, created_at DESC)
  - Use IF NOT EXISTS for idempotency
- [ ] 2.5 Create rollback: `002_add_indexes.down.sql`
- [ ] 2.6 Add npm scripts for migrations
  ```json
  "db:migrate": "psql $DATABASE_URL -f migrations/001_create_video_requests.sql && psql $DATABASE_URL -f migrations/002_add_indexes.sql",
  "db:migrate:down": "psql $DATABASE_URL -f migrations/002_add_indexes.down.sql && psql $DATABASE_URL -f migrations/001_create_video_requests.down.sql"
  ```
- [ ] 2.7 Test migration apply and rollback locally
  ```bash
  npm run db:migrate
  npm run db:migrate:down
  npm run db:migrate
  ```
- [ ] 2.8 Create migrations/README.md with documentation

## 3. Database Module Implementation

- [ ] 3.1 Create module structure
  ```bash
  mkdir -p src/database
  touch src/database/database.module.ts
  touch src/database/database.service.ts
  touch src/database/database.types.ts
  ```
- [ ] 3.2 Implement `DatabaseService` with Slonik connection pool
  - `createPool()` method with configuration
  - `getPool()` method for query access
  - `testConnection()` for health check
  - OnModuleInit lifecycle hook
  - OnModuleDestroy cleanup
- [ ] 3.3 Define TypeScript interfaces in `database.types.ts`
  - `VideoRequestRow` interface
  - `VideoRequestStatus` enum
  - `CreateVideoRequestInput` interface
  - `UpdateVideoRequestInput` interface
- [ ] 3.4 Implement `DatabaseModule` for NestJS
  - Import ConfigModule
  - Provide DatabaseService globally
  - Export for use in other modules
- [ ] 3.5 Add database health check endpoint
  - Create `HealthController` if not exists
  - Add `/health/database` route
  - Execute `SELECT 1` query
  - Return status and latency
- [ ] 3.6 Add startup validation
  - Check `DATABASE_URL` exists
  - Fail fast if missing
  - Test connection on startup
  - Log connection details (sanitized)

## 4. Request Tracking Service

- [ ] 4.1 Create `RequestTrackingService`
  ```bash
  touch src/database/request-tracking.service.ts
  ```
- [ ] 4.2 Implement `createRequest()` method
  - Accept Discord context and generation parameters
  - Insert into video_requests with status 'pending'
  - Return request UUID
  - Handle duplicate UUID gracefully
- [ ] 4.3 Implement `updateStatus()` method
  - Update status with validation
  - Set timestamps based on status transition
  - Calculate duration_ms for terminal states
  - Enforce state machine transitions
- [ ] 4.4 Implement `setGenerating()` method
  - Update status to 'generating'
  - Store operation_name and gcs_prefix
  - Set started_at timestamp
- [ ] 4.5 Implement `setCompleted()` method
  - Update status to 'completed'
  - Store video_urls array
  - Set completed_at and calculate duration_ms
- [ ] 4.6 Implement `setFailed()` method
  - Update status to 'failed'
  - Store sanitized error_message
  - Set completed_at and calculate duration_ms
- [ ] 4.7 Implement `setTimeout()` method
  - Update status to 'timeout'
  - Store timeout error message
  - Set completed_at
- [ ] 4.8 Add error handling with graceful degradation
  - Try-catch around all database operations
  - Log errors with full context
  - Return synthetic data if database unavailable
- [ ] 4.9 Add structured logging for all operations
  - Log request creation with sanitized prompt
  - Log status transitions with timing
  - Warn on slow queries (>100ms)

## 5. Query Methods for Analytics

- [ ] 5.1 Implement `getRequestById(id: string)` method
  - Query by primary key
  - Return full request object or null
- [ ] 5.2 Implement `getRequestsByUser(userId: string, options)` method
  - Query with pagination (limit, offset)
  - Filter by status if provided
  - Order by created_at DESC
- [ ] 5.3 Implement `getRequestsByGuild(guildId: string, options)` method
  - Similar to user query
  - Use guild_id index
- [ ] 5.4 Implement `getGuildStatistics(guildId: string)` method
  - Aggregate query for counts by status
  - Calculate average duration_ms
  - Return top prompts
- [ ] 5.5 Implement `getGlobalStatistics(timeRange)` method
  - Count requests by status in time range
  - Calculate P50, P95, P99 latency
  - Calculate failure rate
  - Optimize with status index

## 6. Database-Backed Rate Limiting

- [ ] 6.1 Backup existing rate-limit.service.ts
  - Copy to rate-limit.service.ts.backup
  - Keep Redis logic commented for 1 release
- [ ] 6.2 Refactor `RateLimitService` to use database
  - Remove Redis client initialization
  - Remove in-memory store
  - Inject `RequestTrackingService`
- [ ] 6.3 Implement `consume(userId: string)` with database query
  ```sql
  SELECT COUNT(*) FROM video_requests
  WHERE user_id = $1
    AND created_at >= NOW() - INTERVAL '24 hours'
  ```
  - Query recent requests count
  - Return RateLimitResult
  - Calculate reset time from oldest request
- [ ] 6.4 Implement `getRemainingQuota(userId: string)`
  - Query count without creating request
  - Return (5 - count)
- [ ] 6.5 Implement `getRateLimitInfo(userId: string)`
  - Query for quota, reset time
  - Format human-readable reset string
- [ ] 6.6 Add graceful degradation for database errors
  - Catch query failures
  - Log error and return `{ allowed: true }` (fail open)
  - Warn "Rate limiting degraded"
- [ ] 6.7 Optimize rate limit query performance
  - Use LIMIT 1 to short-circuit
  - Leverage (user_id, created_at DESC) index
  - Test with 1M+ rows

## 7. Integration with Discord Command

- [ ] 7.1 Update `VeoCommand.execute()` to create request
  - Inject `RequestTrackingService`
  - Call `createRequest()` after rate limit check passes
  - Store request ID in command context
- [ ] 7.2 Update status to 'generating' when operation starts
  - Call `setGenerating()` after `veoService.startGeneration()`
  - Pass operation_name and gcs_prefix
- [ ] 7.3 Update status to 'completed' on success
  - Call `setCompleted()` after public URLs generated
  - Pass video_urls array
- [ ] 7.4 Update status to 'failed' on error
  - Call `setFailed()` in catch block
  - Pass sanitized error message
- [ ] 7.5 Update status to 'timeout' on polling timeout
  - Catch timeout error from `pollOperation()`
  - Call `setTimeout()`
- [ ] 7.6 Add timing metrics to logs
  - Log duration_ms for completed requests
  - Log queueing time (started_at - created_at)

## 8. Testing

- [ ] 8.1 Write unit tests for `DatabaseService`
  - Test connection pool creation
  - Test query execution
  - Mock Slonik client
- [ ] 8.2 Write unit tests for `RequestTrackingService`
  - Test all CRUD operations
  - Test status transitions
  - Mock database queries
- [ ] 8.3 Write unit tests for database-backed rate limiting
  - Test quota enforcement
  - Test rolling window behavior
  - Test reset time calculation
- [ ] 8.4 Write integration tests with test database
  - Set up test PostgreSQL container
  - Apply migrations to test DB
  - Test full request lifecycle
  - Test rate limiting with real queries
- [ ] 8.5 Load test rate limiting performance
  - Insert 100k+ requests
  - Measure query latency for rate checks
  - Verify <50ms performance target
- [ ] 8.6 Test graceful degradation
  - Simulate database unavailable
  - Verify requests still process
  - Verify appropriate logging

## 9. Documentation

- [ ] 9.1 Update README.md with database setup instructions
  - PostgreSQL installation options
  - Cloud SQL setup for GCP
  - Local Docker Compose setup
- [ ] 9.2 Document environment variables
  - `DATABASE_URL` format and examples
  - `DATABASE_MAX_CONNECTIONS` guidance
  - `REQUEST_RETENTION_DAYS` usage
- [ ] 9.3 Create database schema documentation
  - Document video_requests table structure
  - Explain status state machine
  - Document indexes and query patterns
- [ ] 9.4 Add troubleshooting section
  - "Database connection failed" errors
  - "Rate limiting degraded" warnings
  - Query performance issues
  - Migration rollback procedures
- [ ] 9.5 Document SQL migration management
  - How to create new migrations
  - How to apply/rollback with npm scripts
  - Migration best practices
- [ ] 9.6 Update deployment guide
  - Cloud SQL setup for Cloud Run
  - Connection string configuration
  - Migration application in CI/CD

## 10. Deployment Preparation

- [ ] 10.1 Create Cloud SQL instance (if using GCP)
  ```bash
  gcloud sql instances create discord-video-db \
    --database-version=POSTGRES_14 \
    --tier=db-f1-micro \
    --region=us-central1
  ```
- [ ] 10.2 Create database and user
  ```bash
  gcloud sql databases create discord_video_prod
  ```
- [ ] 10.3 Apply migrations to production database
  ```bash
  export DATABASE_URL="postgresql://..."
  npm run db:migrate
  ```
- [ ] 10.4 Update Cloud Run service with DATABASE_URL
  ```bash
  gcloud run services update discord-video-bot \
    --set-env-vars="DATABASE_URL=postgresql://..."
  ```
- [ ] 10.5 Verify database connectivity from Cloud Run
  - Check health endpoint
  - Test request creation
  - Monitor logs for errors
- [ ] 10.6 Monitor rate limiting behavior
  - Compare with previous Redis-based counts
  - Verify quota enforcement
  - Check query performance

## 11. Cleanup and Finalization

- [ ] 11.1 Remove Redis client code from production
  - Delete commented backup code after 1 stable release
  - Remove Redis service account dependencies
- [ ] 11.2 Update `package.json` scripts
  - Add `db:migrate` script for applying migrations
  - Add `db:migrate:down` script for rollback
- [ ] 11.3 Add `.gitignore` entries
  - Local database files (if any)
- [ ] 11.4 Create PR with all changes
  - Reference this OpenSpec proposal
  - Include migration instructions
  - Tag as breaking change (Redis removal)
- [ ] 11.5 After deployment, archive this OpenSpec change
  ```bash
  openspec archive add-postgres-request-tracking
  ```

## Validation Checklist

Each task should be validated with:
- [ ] Code compiles without TypeScript errors
- [ ] Unit tests pass
- [ ] Integration tests pass (if applicable)
- [ ] Manual testing confirms behavior
- [ ] Documentation updated
- [ ] No console errors or warnings
- [ ] Performance meets targets (<50ms rate checks)
