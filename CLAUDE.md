<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Database Migrations

When adding new database migrations:
1. Create the migration file in `migrations/` (e.g., `006_your_migration.sql`)
2. **IMPORTANT**: Also update `src/scripts/run-migrations.ts` to include the new migration in the `migrations` array
3. The migration script uses a hardcoded list - it does NOT auto-discover migration files

# Slonik Timestamps

**IMPORTANT**: Slonik returns PostgreSQL `TIMESTAMPTZ` columns as **strings**, not JavaScript `Date` objects.

When working with timestamp columns from database queries:
- Always wrap in `new Date()` before calling `.getTime()` or `.toISOString()`
- Example: `new Date(row.created_at).toISOString()` instead of `row.created_at.toISOString()`