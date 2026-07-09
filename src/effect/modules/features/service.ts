import { Cache, Duration, Effect } from 'effect';
import {
  type FeatureKey,
  type TenantFeaturesResponseDto,
  type UpdateTenantFeatureOverride,
  type UpdateTenantPlan,
} from '@stocket/types/features';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import {
  FeatureTenantNotFound,
  type FeaturesInfrastructureError,
} from './features.errors';
import { FeaturesRepository } from './repository';
import { buildTenantFeaturesResponse } from './mappers';
import { makeFeatureWriteWorkflows } from './write';
import { makeFeatureAccess } from './access';

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

      const getFeaturesForTenant = (tenantId: string) =>
        featureCache
          .get(tenantId)
          .pipe(
            trace.span('getFeaturesForTenant', { attributes: { tenantId } }),
          );

      const featureWriteWorkflows = makeFeatureWriteWorkflows({
        repository,
        invalidateTenant,
        loadFeaturesForTenant,
      });
      const featureAccess = makeFeatureAccess({ getFeaturesForTenant });

      const setTenantPlan = (
        tenantId: string,
        dto: UpdateTenantPlan,
        actorUserId: string,
      ) =>
        featureWriteWorkflows
          .setTenantPlan(tenantId, dto, actorUserId)
          .pipe(trace.span('setTenantPlan', { attributes: { tenantId } }));

      const setFeatureOverride = (
        tenantId: string,
        featureKey: FeatureKey,
        dto: UpdateTenantFeatureOverride,
        actorUserId: string,
      ) =>
        featureWriteWorkflows
          .setFeatureOverride(tenantId, featureKey, dto, actorUserId)
          .pipe(trace.span('setFeatureOverride', { attributes: { tenantId } }));

      const clearFeatureOverride = (tenantId: string, featureKey: FeatureKey) =>
        featureWriteWorkflows
          .clearFeatureOverride(tenantId, featureKey)
          .pipe(
            trace.span('clearFeatureOverride', { attributes: { tenantId } }),
          );

      const requireFeature = (featureKey: FeatureKey) =>
        featureAccess.requireFeature(featureKey).pipe(
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
