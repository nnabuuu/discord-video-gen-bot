import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  console.log('Connecting to database...');
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    const migrations = [
      'migrations/001_create_video_requests.sql',
      'migrations/002_add_indexes.sql',
      'migrations/003_add_request_type.sql',
    ];

    for (const migrationFile of migrations) {
      console.log(`Running migration: ${migrationFile}`);
      const sqlContent = fs.readFileSync(path.join(process.cwd(), migrationFile), 'utf-8');

      await client.query(sqlContent);

      console.log(`✓ ${migrationFile} completed`);
    }

    console.log('\nAll migrations completed successfully!');
  } catch (error) {
    console.error('\nMigration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
