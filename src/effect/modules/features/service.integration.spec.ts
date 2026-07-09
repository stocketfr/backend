import { Effect, Layer } from 'effect';
import {
  FeatureKey,
  PlanKey,
  type UpdateTenantFeatureOverride,
} from '@stocket/types/features';
import { eq } from 'drizzle-orm';
import {
  organizations,
  tenantFeatureOverrides,
} from '../../platform/db/schema';
import { DEFAULT_TENANT_ID } from '../../platform/tenancy/tenant-constants';
import {
  getTestDb,
  makeTestDrizzleLayer,
  runTest,
  TEST_USER_ID,
  withTestDb,
} from '../../testing/test-harness';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { FeaturesService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<FeaturesService>;

withTestDb();
beforeAll(() => {
  db = getTestDb();
  TestLayer = FeaturesService.Default.pipe(
    Layer.provide(makeTestDrizzleLayer()),
  );
});

const seedTenant = async () => {
  await db
    .insert(organizations)
    .values({
      id: DEFAULT_TENANT_ID,
      name: 'Stocket',
      slug: 'stocket',
    })
    .onConflictDoNothing();
};

describe('FeaturesService integration', () => {
  it('returns default free-plan features when no entitlement rows exist', async () => {
    await seedTenant();

    const result = await runTest(
      Effect.flatMap(FeaturesService, (svc) =>
        svc.getFeaturesForTenant(DEFAULT_TENANT_ID),
      ),
      TestLayer,
    );

    expect(result.planKey).toBe(PlanKey.FREE);
    expect(result.features).toEqual({
      [FeatureKey.SMART_IMPORT]: false,
      [FeatureKey.ORDERS]: true,
    });
  });

  it('persists plan and feature overrides for a tenant', async () => {
    await seedTenant();

    const dto: UpdateTenantFeatureOverride = {
      enabled: true,
      reason: 'Beta tenant',
      expires_at: null,
    };

    const result = await runTest(
      Effect.flatMap(FeaturesService, (svc) =>
        Effect.flatMap(
          svc.setTenantPlan(
            DEFAULT_TENANT_ID,
            { planKey: PlanKey.BASE },
            TEST_USER_ID,
          ),
          () =>
            svc.setFeatureOverride(
              DEFAULT_TENANT_ID,
              FeatureKey.SMART_IMPORT,
              dto,
              TEST_USER_ID,
            ),
        ),
      ),
      TestLayer,
    );

    expect(result.planKey).toBe(PlanKey.BASE);
    expect(result.features[FeatureKey.SMART_IMPORT]).toBe(true);
    const rows = await db
      .select()
      .from(tenantFeatureOverrides)
      .where(eq(tenantFeatureOverrides.tenant_id, DEFAULT_TENANT_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature_key: FeatureKey.SMART_IMPORT,
      enabled: true,
      reason: 'Beta tenant',
      updated_by: TEST_USER_ID,
    });
  });
});
