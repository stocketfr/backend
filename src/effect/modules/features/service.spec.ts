import { Effect, Layer } from 'effect';
import {
  EntitlementSource,
  FeatureKey,
  PlanKey,
} from '@stocket/types/features';
import { CurrentRequestContext } from '../../platform/http/request-context';
import { DEFAULT_TENANT_ID } from '../../platform/tenancy/tenant-constants';
import { FeaturesRepository } from './repository';
import { FeaturesService } from './service';

const requestContext = {
  requestId: '00000000-0000-4000-8000-000000000099',
  path: '/api/v1/features',
  method: 'GET' as const,
  ip: null,
  locale: 'en' as const,
  tenantId: DEFAULT_TENANT_ID,
};

const profile = (planKey: PlanKey) =>
  ({
    tenant_id: DEFAULT_TENANT_ID,
    plan_key: planKey,
    source: EntitlementSource.MANUAL,
    updated_by: 'admin-1',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  }) as const;

const override = (
  featureKey: FeatureKey,
  enabled: boolean,
  expiresAt: Date | null = null,
) =>
  ({
    id: '00000000-0000-4000-8000-000000000777',
    tenant_id: DEFAULT_TENANT_ID,
    feature_key: featureKey,
    enabled,
    reason: null,
    expires_at: expiresAt,
    updated_by: 'admin-1',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  }) as const;

const makeService = async (repository: Partial<FeaturesRepository>) =>
  Effect.runPromise(
    FeaturesService.pipe(
      Effect.provide(
        FeaturesService.DefaultWithoutDependencies.pipe(
          Layer.provide(
            Layer.succeed(
              FeaturesRepository,
              repository as typeof FeaturesRepository.Service,
            ),
          ),
        ),
      ),
    ),
  );

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    effect.pipe(Effect.provideService(CurrentRequestContext, requestContext)),
  );

const fail = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.flip(
      effect.pipe(Effect.provideService(CurrentRequestContext, requestContext)),
    ),
  );

describe('FeaturesService', () => {
  it('uses the free plan when no tenant profile exists', async () => {
    const service = await makeService({
      tenantExists: () => Effect.succeed(true),
      findProfile: () => Effect.succeed(null),
      listOverrides: () => Effect.succeed([]),
    });

    const result = await run(service.getFeaturesForTenant(DEFAULT_TENANT_ID));

    expect(result.planKey).toBe(PlanKey.FREE);
    expect(result.source).toBe(EntitlementSource.SYSTEM);
    expect(result.features).toEqual({
      [FeatureKey.SMART_IMPORT]: false,
      [FeatureKey.ORDERS]: true,
    });
  });

  it('applies active tenant overrides over plan defaults', async () => {
    const service = await makeService({
      tenantExists: () => Effect.succeed(true),
      findProfile: () => Effect.succeed(profile(PlanKey.FREE)),
      listOverrides: () =>
        Effect.succeed([
          override(
            FeatureKey.SMART_IMPORT,
            true,
            new Date('2030-01-01T00:00:00.000Z'),
          ),
        ]),
    });

    const result = await run(service.getFeaturesForTenant(DEFAULT_TENANT_ID));

    expect(result.features[FeatureKey.SMART_IMPORT]).toBe(true);
    expect(result.features[FeatureKey.ORDERS]).toBe(true);
  });

  it('ignores expired overrides', async () => {
    const service = await makeService({
      tenantExists: () => Effect.succeed(true),
      findProfile: () => Effect.succeed(profile(PlanKey.GROWTH)),
      listOverrides: () =>
        Effect.succeed([
          override(
            FeatureKey.SMART_IMPORT,
            false,
            new Date('2020-01-01T00:00:00.000Z'),
          ),
        ]),
    });

    const result = await run(service.getFeaturesForTenant(DEFAULT_TENANT_ID));

    expect(result.features[FeatureKey.SMART_IMPORT]).toBe(true);
  });

  it('invalidates cached values after a plan update', async () => {
    const findProfile = vi
      .fn()
      .mockReturnValueOnce(Effect.succeed(profile(PlanKey.BASE)))
      .mockReturnValueOnce(Effect.succeed(profile(PlanKey.GROWTH)));
    const upsertPlan = vi.fn(() => Effect.void);
    const service = await makeService({
      tenantExists: () => Effect.succeed(true),
      findProfile,
      listOverrides: () => Effect.succeed([]),
      upsertPlan,
    });

    const first = await run(service.getFeaturesForTenant(DEFAULT_TENANT_ID));
    const second = await run(
      service.setTenantPlan(
        DEFAULT_TENANT_ID,
        { planKey: PlanKey.GROWTH },
        'admin-1',
      ),
    );

    expect(first.features[FeatureKey.SMART_IMPORT]).toBe(false);
    expect(second.features[FeatureKey.SMART_IMPORT]).toBe(true);
    expect(upsertPlan).toHaveBeenCalledWith(
      DEFAULT_TENANT_ID,
      PlanKey.GROWTH,
      'admin-1',
    );
  });

  it('fails requireFeature when the effective feature is disabled', async () => {
    const service = await makeService({
      tenantExists: () => Effect.succeed(true),
      findProfile: () => Effect.succeed(profile(PlanKey.FREE)),
      listOverrides: () => Effect.succeed([]),
    });

    const error = await fail(service.requireFeature(FeatureKey.SMART_IMPORT));

    expect(error).toMatchObject({
      _tag: 'FeatureNotEnabled',
      statusCode: 403,
      featureKey: FeatureKey.SMART_IMPORT,
    });
  });
});
