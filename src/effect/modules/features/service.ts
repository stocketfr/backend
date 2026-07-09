import { Cache, Duration, Effect } from 'effect';
import {
  type FeatureKey,
  type TenantFeaturesResponseDto,
  type UpdateTenantFeatureOverride,
  type UpdateTenantPlan,
} from '@stocket/types/features';
import { requireRequestTenantId } from '../../platform/tenancy/tenant-context';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import {
  FeatureNotEnabled,
  FeatureTenantNotFound,
  type FeaturesInfrastructureError,
} from './features.errors';
import { FeaturesRepository } from './repository';
import { buildTenantFeaturesResponse } from './utils';

export class FeaturesService extends Effect.Service<FeaturesService>()(
  '@stocket/effect/features/FeaturesService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* FeaturesRepository;
      const trace = makeServiceTracer({
        serviceName: 'FeaturesService',
        module: 'features',
        layer: 'service',
        entityType: 'tenant',
      });

      const loadFeaturesForTenant = (
        tenantId: string,
      ): Effect.Effect<
        TenantFeaturesResponseDto,
        FeaturesInfrastructureError | FeatureTenantNotFound
      > =>
        Effect.gen(function* () {
          if (!(yield* repository.tenantExists(tenantId))) {
            return yield* Effect.fail(
              new FeatureTenantNotFound({
                tenantId,
                messageKey: 'features.tenantNotFound',
              }),
            );
          }
          const profile = yield* repository.findProfile(tenantId);
          const overrides = yield* repository.listOverrides(tenantId);
          return buildTenantFeaturesResponse(tenantId, profile, overrides);
        });

      const featureCache = yield* Cache.make({
        capacity: 1000,
        timeToLive: Duration.minutes(1),
        lookup: loadFeaturesForTenant,
      });

      const invalidateTenant = (tenantId: string) =>
        featureCache.invalidate(tenantId);

      const requireTenant = (tenantId: string) =>
        Effect.gen(function* () {
          if (yield* repository.tenantExists(tenantId)) {
            return;
          }
          return yield* Effect.fail(
            new FeatureTenantNotFound({
              tenantId,
              messageKey: 'features.tenantNotFound',
            }),
          );
        });

      const getFeaturesForTenant = (tenantId: string) =>
        featureCache
          .get(tenantId)
          .pipe(
            trace.span('getFeaturesForTenant', { attributes: { tenantId } }),
          );

      const setTenantPlan = (
        tenantId: string,
        dto: UpdateTenantPlan,
        actorUserId: string,
      ) =>
        Effect.gen(function* () {
          yield* requireTenant(tenantId);
          yield* repository.upsertPlan(tenantId, dto.planKey, actorUserId);
          yield* invalidateTenant(tenantId);
          return yield* loadFeaturesForTenant(tenantId);
        }).pipe(trace.span('setTenantPlan', { attributes: { tenantId } }));

      const setFeatureOverride = (
        tenantId: string,
        featureKey: FeatureKey,
        dto: UpdateTenantFeatureOverride,
        actorUserId: string,
      ) =>
        Effect.gen(function* () {
          yield* requireTenant(tenantId);
          yield* repository.upsertOverride(
            tenantId,
            featureKey,
            {
              enabled: dto.enabled,
              reason: dto.reason,
              expires_at: dto.expires_at,
            },
            actorUserId,
          );
          yield* invalidateTenant(tenantId);
          return yield* loadFeaturesForTenant(tenantId);
        }).pipe(trace.span('setFeatureOverride', { attributes: { tenantId } }));

      const clearFeatureOverride = (tenantId: string, featureKey: FeatureKey) =>
        Effect.gen(function* () {
          yield* requireTenant(tenantId);
          yield* repository.deleteOverride(tenantId, featureKey);
          yield* invalidateTenant(tenantId);
          return yield* loadFeaturesForTenant(tenantId);
        }).pipe(
          trace.span('clearFeatureOverride', { attributes: { tenantId } }),
        );

      const requireFeature = (featureKey: FeatureKey) =>
        Effect.gen(function* () {
          const tenantId = yield* requireRequestTenantId;
          const { features } = yield* getFeaturesForTenant(tenantId);
          if (features[featureKey]) {
            return;
          }
          return yield* Effect.fail(
            new FeatureNotEnabled({
              featureKey,
              messageKey: 'features.notEnabled',
            }),
          );
        }).pipe(
          trace.span('requireFeature', {
            attributes: { entityId: featureKey },
          }),
        );

      return {
        getFeaturesForTenant,
        invalidateTenant,
        setTenantPlan,
        setFeatureOverride,
        clearFeatureOverride,
        requireFeature,
      };
    }),
    dependencies: [FeaturesRepository.Default],
  },
) {}
