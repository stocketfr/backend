import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { applyCommittedSqlMigrations } from '../platform/db/committed-sql-migrations';
import type { DrizzleDb } from '../platform/db/drizzle';
import * as relations from '../platform/db/relations';
import * as schema from '../platform/db/schema';
import { recordCurrentSchemaVersion } from '../platform/db/schema-version';

const TEST_DB_NAME = 'stocket_inventory_test';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'drizzle');

function getAdminUrl(): string {
  const base =
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432';
  const url = new URL(base);
  url.pathname = '/postgres';
  return url.toString();
}

function getTestUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const admin = getAdminUrl();
  const url = new URL(admin);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

export async function setup(): Promise<void> {
  const adminUrl = getAdminUrl();
  const testUrl = getTestUrl();

  // 1. Create the test database if it doesn't exist
  const adminPool = new pg.Pool({ connectionString: adminUrl });
  try {
    const { rows } = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [TEST_DB_NAME],
    );
    if (rows.length === 0) {
      await adminPool.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
      console.info(`Created test database: ${TEST_DB_NAME}`);
    }
  } finally {
    await adminPool.end();
  }

  // 2. Apply the same committed SQL migrations used at application startup.
  const testPool = new pg.Pool({ connectionString: testUrl });
  try {
    const testDb = drizzle(testPool, {
      schema: { ...schema, ...relations },
    }) as unknown as DrizzleDb;
    await applyCommittedSqlMigrations(testDb, MIGRATIONS_DIR);
    // The integration harness supplies auth and data fixtures independently.
    await recordCurrentSchemaVersion(testDb);
  } finally {
    await testPool.end();
  }
}
