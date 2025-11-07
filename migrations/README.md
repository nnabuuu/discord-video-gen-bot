# Database Migrations

This directory contains SQL migrations for the Discord video generation bot database.

## Migration Files

Migrations are numbered and should be run in order:

- `001_create_video_requests.sql` - Create video_requests table
- `002_add_indexes.sql` - Add performance indexes

Each migration has a corresponding `.down.sql` file for rollback.

## Running Migrations

### Local Development

Migrations run automatically when you start Docker Compose (on first container start):

```bash
docker-compose up -d
```

To run migrations manually:

```bash
npm run db:migrate
```

### Production

Set your production `DATABASE_URL` and run:

```bash
export DATABASE_URL="postgresql://user:password@host:5432/database"
npm run db:migrate
```

Or run migrations directly with psql:

```bash
psql $DATABASE_URL -f migrations/001_create_video_requests.sql
psql $DATABASE_URL -f migrations/002_add_indexes.sql
```

## Rolling Back

To rollback all migrations:

```bash
npm run db:migrate:down
```

Or rollback manually (in reverse order):

```bash
psql $DATABASE_URL -f migrations/002_add_indexes.down.sql
psql $DATABASE_URL -f migrations/001_create_video_requests.down.sql
```

## Creating New Migrations

1. Create a new file with the next number: `003_your_migration_name.sql`
2. Write your SQL changes
3. Create a corresponding `003_your_migration_name.down.sql` for rollback
4. Update `package.json` scripts to include the new migration
5. Test locally before deploying to production

## Best Practices

- Always test migrations on a copy of production data first
- Create database backups before running migrations in production
- Use `IF NOT EXISTS` / `IF EXISTS` clauses for idempotency
- Keep migrations small and focused on one change
- Never modify existing migration files that have been deployed
