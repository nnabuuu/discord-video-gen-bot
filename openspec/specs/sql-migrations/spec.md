# sql-migrations Specification

## Purpose
TBD - created by archiving change add-postgres-request-tracking. Update Purpose after archive.
## Requirements
### Requirement: Manual SQL Migration Structure
The system SHALL use plain SQL migration files managed with psql commands for database schema management.

#### Scenario: Migration directory initialization
- **WHEN** setting up project for first time
- **THEN** create `migrations/` directory in project root
- **AND** add `README.md` with migration instructions
- **AND** commit migrations directory to version control

#### Scenario: Local PostgreSQL development setup
- **WHEN** developer runs project locally
- **THEN** start PostgreSQL 14+ via Docker Compose
- **AND** expose on `localhost:5432`
- **AND** auto-apply migrations on first container start via `/docker-entrypoint-initdb.d`

### Requirement: Video Requests Table Migration
The system SHALL create `video_requests` table via SQL migration file with proper schema and constraints.

#### Scenario: Initial table creation migration
- **WHEN** applying first migration
- **THEN** execute SQL from `migrations/001_create_video_requests.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS video_requests (
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
    error_message TEXT
  );
  ```
- **AND** use `IF NOT EXISTS` for idempotency
- **AND** create corresponding `001_create_video_requests.down.sql` for rollback:
  ```sql
  DROP TABLE IF EXISTS video_requests;
  ```

#### Scenario: Index creation for performance
- **WHEN** applying index migration from `migrations/002_add_indexes.sql`
- **THEN** create indexes for common query patterns:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_video_requests_user_created
    ON video_requests (user_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_video_requests_status_created
    ON video_requests (status, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_video_requests_guild_created
    ON video_requests (guild_id, created_at DESC);
  ```
- **AND** use `IF NOT EXISTS` for idempotency
- **AND** verify index usage with EXPLAIN ANALYZE

### Requirement: Migration Version Control
The system SHALL track all database schema changes via numbered migration files in version control.

#### Scenario: Creating new migration
- **WHEN** developer needs to modify schema
- **THEN** create new migration file with next number: `003_description.sql`
- **AND** write SQL for forward migration
- **AND** create corresponding `003_description.down.sql` for rollback
- **AND** use `IF NOT EXISTS` / `IF EXISTS` clauses for idempotency
- **AND** commit migration files to version control

#### Scenario: Applying migrations via npm script
- **WHEN** deploying to new environment
- **THEN** run `npm run db:migrate`
- **AND** execute all migration files in numeric order via psql
- **AND** use `DATABASE_URL` environment variable for connection
- **AND** safe to run multiple times (idempotent with IF NOT EXISTS)

#### Scenario: Rolling back migration
- **WHEN** migration causes issues
- **THEN** run `npm run db:migrate:down`
- **AND** execute rollback files in reverse numeric order via psql
- **AND** use `IF EXISTS` clauses to prevent errors if already rolled back

### Requirement: Docker Compose Auto-Migration
The system SHALL automatically apply migrations on first PostgreSQL container startup.

#### Scenario: First-time container startup
- **WHEN** PostgreSQL container starts for first time
- **THEN** mount `migrations/` directory to `/docker-entrypoint-initdb.d`
- **AND** PostgreSQL automatically executes all `*.sql` files in alphabetical order
- **AND** migrations run before application starts
- **AND** database is ready with schema when bot connects

#### Scenario: Subsequent container startups
- **WHEN** PostgreSQL container restarts with existing data volume
- **THEN** skip `/docker-entrypoint-initdb.d` scripts (only runs once)
- **AND** schema persists from previous startup
- **AND** developers use `npm run db:migrate` for new migrations

### Requirement: Migration Testing
The system SHALL validate migrations before deployment via local testing.

#### Scenario: Local migration testing
- **WHEN** testing new migration locally
- **THEN** apply migration via `npm run db:migrate`
- **AND** verify schema changes with `psql $DATABASE_URL -c "\d video_requests"`
- **AND** test rollback via `npm run db:migrate:down`
- **AND** re-apply via `npm run db:migrate`
- **AND** confirm idempotent behavior (no errors on re-run)

#### Scenario: Fresh database verification
- **WHEN** verifying migration from scratch
- **THEN** destroy database volume: `docker-compose down -v`
- **AND** restart containers: `docker-compose up -d`
- **AND** verify migrations auto-applied correctly
- **AND** test application connects successfully

### Requirement: Environment-Specific Migration Application
The system SHALL support migrations across multiple database environments.

#### Scenario: Local development database
- **WHEN** running locally
- **THEN** connect to `postgresql://discord_video:dev_password@localhost:5432/discord_video_dev`
- **AND** use `.env` file for `DATABASE_URL`
- **AND** auto-apply migrations via Docker Compose

#### Scenario: Production database (Cloud SQL)
- **WHEN** deploying to production
- **THEN** set `DATABASE_URL` for production Cloud SQL instance
- **AND** run `npm run db:migrate` manually or via CI/CD
- **AND** verify schema changes before starting application
- **AND** create database backup before applying migrations

### Requirement: Migration Safety and Idempotency
The system SHALL ensure migrations are safe to run multiple times.

#### Scenario: Idempotent table creation
- **WHEN** migration creates table
- **THEN** use `CREATE TABLE IF NOT EXISTS`
- **AND** running twice does not error
- **AND** existing data is preserved

#### Scenario: Idempotent index creation
- **WHEN** migration creates index
- **THEN** use `CREATE INDEX IF NOT EXISTS`
- **AND** running twice does not error
- **AND** index is only created once

#### Scenario: Idempotent rollback
- **WHEN** migration rollback drops table or index
- **THEN** use `DROP TABLE IF EXISTS` or `DROP INDEX IF EXISTS`
- **AND** running twice does not error
- **AND** safe even if table/index already removed

### Requirement: Migration Documentation
The system SHALL document migration procedures in `migrations/README.md`.

#### Scenario: Migration guide
- **WHEN** developer needs to manage migrations
- **THEN** refer to `migrations/README.md` for:
  - How to run migrations locally
  - How to create new migrations
  - How to rollback migrations
  - Production migration procedures
  - Best practices and guidelines

#### Scenario: Production migration instructions
- **WHEN** deploying to production
- **THEN** follow documented procedure:
  1. Create database backup
  2. Test migration on staging first
  3. Set production `DATABASE_URL`
  4. Run `npm run db:migrate`
  5. Verify schema changes
  6. Start application
  7. Monitor for errors

### Requirement: npm Script Wrappers
The system SHALL provide npm scripts for convenient migration management.

#### Scenario: Apply all migrations
- **WHEN** running `npm run db:migrate`
- **THEN** execute all migration files in order via psql
- **AND** use `DATABASE_URL` from environment
- **AND** output SQL execution results
- **AND** exit with error code if any migration fails

#### Scenario: Rollback all migrations
- **WHEN** running `npm run db:migrate:down`
- **THEN** execute all rollback files in reverse order via psql
- **AND** use `DATABASE_URL` from environment
- **AND** output SQL execution results
- **AND** exit with error code if any rollback fails

### Requirement: Backup Before Migration (Production)
The system SHALL recommend database backup before applying migrations in production.

#### Scenario: Pre-migration backup documentation
- **WHEN** deploying to production Cloud SQL
- **THEN** document backup command in README:
  ```bash
  gcloud sql backups create --instance=discord-video-db
  ```
- **AND** recommend testing on staging first
- **AND** recommend backup before every migration

#### Scenario: Migration failure recovery
- **WHEN** migration fails in production
- **AND** data integrity is compromised
- **THEN** restore from pre-migration backup
- **AND** investigate failure cause
- **AND** fix migration and retry on fresh backup

