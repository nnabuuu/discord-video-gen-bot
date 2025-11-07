#!/bin/bash
set -e

# Load .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "Running migrations..."
psql "$DATABASE_URL" -f migrations/001_create_video_requests.sql
psql "$DATABASE_URL" -f migrations/002_add_indexes.sql
echo "Migrations completed successfully!"
