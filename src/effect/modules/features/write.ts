import { Effect } from 'effect';
import type {
  FeatureKey,
  TenantFeaturesResponseDto,
  UpdateTenantFeatureOverride,
  UpdateTenantPlan,
} from '@stocket/types/features';
import {
  FeatureTenantNotFound,
  type FeaturesInfrastructureError,
} from './features.errors';

export interface FeatureWriteRepository {
  readonly tenantExists: (
    tenantId: string,
  ) => Effect.Effect<boolean, FeaturesInfrastructureError>;
  readonly upsertPlan: (
    tenantId: string,
    planKey: UpdateTenantPlan['planKey'],
    actorUserId: string,
  ) => Effect.Effect<unknown, FeaturesInfrastructureError>;
  readonly upsertOverride: (
    tenantId: string,
    featureKey: FeatureKey,
    input: {
      readonly enabled: boolean;
      readonly reason?: string | null;
      readonly expires_at?: Date | null;
    },
    actorUserId: string,
  ) => Effect.Effect<unknown, FeaturesInfrastructureError>;
  readonly deleteOverride: (
    tenantId: string,
    featureKey: FeatureKey,
  ) => Effect.Effect<unknown, FeaturesInfrastructureError>;
}

interface FeatureWriteWorkflowOptions<LoadError, LoadContext> {
  readonly repository: FeatureWriteRepository;
  readonly invalidateTenant: (tenantId: string) => Effect.Effect<void>;
  readonly loadFeaturesForTenant: (
    tenantId: string,
  ) => Effect.Effect<TenantFeaturesResponseDto, LoadError, LoadContext>;
}

const ensureTenantExists = (
  repository: FeatureWriteRepository,
  tenantId: string,
) =>
  repository.tenantExists(tenantId).pipe(
    Effect.filterOrFail(
      Boolean,
      () =>
        new FeatureTenantNotFound({
          tenantId,
          messageKey: 'features.tenantNotFound',
        }),
    ),
    Effect.asVoid,
  );

export const makeFeatureWriteWorkflows = <LoadError, LoadContext>({
  repository,
  invalidateTenant,
  loadFeaturesForTenant,
}: FeatureWriteWorkflowOptions<LoadError, LoadContext>) => {
  const reloadAfterWrite = (tenantId: string) =>
    Effect.gen(function* () {
      yield* invalidateTenant(tenantId);
      return yield* loadFeaturesForTenant(tenantId);
    });

  const setTenantPlan = (
    tenantId: string,
    dto: UpdateTenantPlan,
    actorUserId: string,
  ) =>
    Effect.gen(function* () {
      yield* ensureTenantExists(repository, tenantId);
      yield* repository.upsertPlan(tenantId, dto.planKey, actorUserId);
      return yield* reloadAfterWrite(tenantId);
    });

  const setFeatureOverride = (
    tenantId: string,
    featureKey: FeatureKey,
    dto: UpdateTenantFeatureOverride,
    actorUserId: string,
  ) =>
    Effect.gen(function* () {
      yield* ensureTenantExists(repository, tenantId);
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
      return yield* reloadAfterWrite(tenantId);
    });

  const clearFeatureOverride = (tenantId: string, featureKey: FeatureKey) =>
    Effect.gen(function* () {
      yield* ensureTenantExists(repository, tenantId);
      yield* repository.deleteOverride(tenantId, featureKey);
      return yield* reloadAfterWrite(tenantId);
    });

  return {
    setTenantPlan,
    setFeatureOverride,
    clearFeatureOverride,
  };
};
