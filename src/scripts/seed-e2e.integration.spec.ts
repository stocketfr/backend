import { and, eq } from 'drizzle-orm';
import { FeatureKey } from '@stocket/types/features';
import {
  organizations,
  tenantFeatureOverrides,
} from '../effect/platform/db/schema';
import type { DrizzleDb } from '../effect/platform/db/drizzle';
import {
  getTestDb,
  seedBetterAuthUser,
  TEST_USER_ID,
  withTestDb,
} from '../effect/testing/test-harness';
import { seedE2eTenant } from './seed-e2e';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/stocket_inventory_test';

const OTHER_TENANT_ID = '00000000-0000-4000-a000-000000000099';
const E2E_USER_EMAIL = 'seed-smart-import@stocket.local';

let db: DrizzleDb;

withTestDb();

beforeAll(() => {
  db = getTestDb();
});

describe('seedE2eTenant feature overrides', () => {
  it('idempotently enables smart import only for the seeded tenant', async () => {
    await seedBetterAuthUser(db, {
      id: TEST_USER_ID,
      email: E2E_USER_EMAIL,
    });
    await db.insert(organizations).values({
      id: OTHER_TENANT_ID,
      name: 'Other tenant',
      slug: 'other-tenant',
    });
    await db.insert(tenantFeatureOverrides).values({
      tenant_id: OTHER_TENANT_ID,
      feature_key: FeatureKey.SMART_IMPORT,
      enabled: false,
      reason: 'Keep disabled',
    });

    const options = {
      databaseUrl: TEST_DATABASE_URL,
      tenantName: 'Smart Import E2E Tenant',
      tenantSlug: 'smart-import-e2e',
      tenantHostname: 'smart-import-e2e.localhost:3000',
      userEmail: E2E_USER_EMAIL,
    } as const;

    const first = await seedE2eTenant(options);
    const second = await seedE2eTenant(options);

    expect(second.tenantId).toBe(first.tenantId);

    const seededOverrides = await db
      .select()
      .from(tenantFeatureOverrides)
      .where(
        and(
          eq(tenantFeatureOverrides.tenant_id, first.tenantId),
          eq(tenantFeatureOverrides.feature_key, FeatureKey.SMART_IMPORT),
        ),
      );
    expect(seededOverrides).toHaveLength(1);
    expect(seededOverrides[0]).toMatchObject({
      enabled: true,
      reason: 'Enabled for E2E product import coverage',
      expires_at: null,
      updated_by: TEST_USER_ID,
    });

    const otherTenantOverrides = await db
      .select()
      .from(tenantFeatureOverrides)
      .where(
        and(
          eq(tenantFeatureOverrides.tenant_id, OTHER_TENANT_ID),
          eq(tenantFeatureOverrides.feature_key, FeatureKey.SMART_IMPORT),
        ),
      );
    expect(otherTenantOverrides).toHaveLength(1);
    expect(otherTenantOverrides[0]).toMatchObject({
      enabled: false,
      reason: 'Keep disabled',
    });
  });
});
