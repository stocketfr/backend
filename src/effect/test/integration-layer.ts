import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { Layer } from 'effect';
import { DrizzleDatabase, type DrizzleDb } from '../platform/drizzle';
import * as schema from '../platform/db/schema';
import * as relations from '../platform/db/relations';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../platform/request-context';
import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_NAME,
  DEFAULT_TENANT_SLUG,
} from '../platform/tenant-constants';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/stocket_inventory_test';

let pool: pg.Pool | null = null;
let db: DrizzleDb | null = null;

export function getTestDb(): DrizzleDb {
  if (!db) {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
    // drizzle()'s schema param rejects the spread-merge of relations at the type level,
    // but the runtime shape matches DrizzleDb; the cast is safe here.
    db = drizzle(pool, {
      schema: { ...schema, ...relations },
    }) as unknown as DrizzleDb;
  }
  return db;
}

export async function closeTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

export function makeTestRequestContext(): RequestContext {
  return {
    requestId: '00000000-0000-4000-8000-000000000099',
    path: '/api/v1/test',
    method: 'GET',
    ip: null,
    locale: 'en',
    tenantId: DEFAULT_TENANT_ID,
    tenantName: DEFAULT_TENANT_NAME,
    tenantSlug: DEFAULT_TENANT_SLUG,
  };
}

export async function truncateAll(): Promise<void> {
  const testDb = getTestDb();
  await testDb.execute(sql`
    TRUNCATE TABLE
	      audit_logs, stock_movements, order_items, orders,
	      inventory, photos, supplier_products, products,
	      areas, locations, categories, suppliers, clients,
	      branding_settings, notification_preferences, notifications,
	      role_permissions, user_roles, roles
	    CASCADE
	  `);
  await testDb.execute(sql`
    DO $$
    BEGIN
      IF to_regclass('public.member') IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE "member" CASCADE';
      END IF;
      IF to_regclass('public.organization') IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE "organization" CASCADE';
      END IF;
    END $$;
  `);
  await testDb.execute(
    sql`ALTER SEQUENCE IF EXISTS order_number_seq RESTART WITH 1`,
  );
}

export function makeTestDrizzleLayer() {
  return Layer.mergeAll(
    Layer.succeed(DrizzleDatabase, getTestDb()),
    Layer.succeed(CurrentRequestContext, makeTestRequestContext()),
  );
}
