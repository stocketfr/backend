import { randomUUID } from 'node:crypto';
import { Effect, Layer } from 'effect';
import { DEFAULT_FEATURE_STATES, FeatureKey } from '@stocket/types/features';
import {
  organizations,
  tenantDomains,
  tenantFeatureOverrides,
} from '../../platform/db/schema';
import {
  getTestDb,
  makeTestDrizzleLayer,
  withTestDb,
} from '../../testing/test-harness';
import { SuperAdminRepository } from './repository';

withTestDb();

const runRepository = <A, E>(
  effect: Effect.Effect<A, E, SuperAdminRepository>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        SuperAdminRepository.Default.pipe(
          Layer.provide(makeTestDrizzleLayer()),
        ),
      ),
    ),
  );

describe('SuperAdminRepository tenant features', () => {
  it('upserts non-default feature overrides and clears default-equivalent values', async () => {
    const db = getTestDb();
    const tenantId = randomUUID();

    await db.insert(organizations).values({
      id: tenantId,
      name: 'Feature Tenant',
      slug: `feature-${tenantId.slice(0, 8)}`,
    });
    await db.insert(tenantDomains).values({
      tenant_id: tenantId,
      hostname: `feature-${tenantId.slice(0, 8)}.localhost:3000`,
      kind: 'subdomain',
      is_primary: true,
      verified_at: new Date(),
    });

    await runRepository(
      Effect.flatMap(SuperAdminRepository, (repository) =>
        repository.updateTenant({
          tenantId,
          name: 'Feature Tenant Updated',
          features: {
            ...DEFAULT_FEATURE_STATES,
            [FeatureKey.SMART_IMPORT]: true,
          },
          updatedBy: 'superadmin-1',
        }),
      ),
    );

    const enabledOverrides = await db.select().from(tenantFeatureOverrides);

    expect(enabledOverrides).toHaveLength(1);
    expect(enabledOverrides[0]).toMatchObject({
      tenant_id: tenantId,
      feature_key: FeatureKey.SMART_IMPORT,
      enabled: true,
      updated_by: 'superadmin-1',
    });

    await runRepository(
      Effect.flatMap(SuperAdminRepository, (repository) =>
        repository.updateTenant({
          tenantId,
          name: 'Feature Tenant Updated Again',
          features: DEFAULT_FEATURE_STATES,
          updatedBy: 'superadmin-1',
        }),
      ),
    );

    const clearedOverrides = await db.select().from(tenantFeatureOverrides);

    expect(clearedOverrides).toHaveLength(0);
  });
});
