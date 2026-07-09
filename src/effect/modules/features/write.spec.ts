import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  EntitlementSource,
  FeatureKey,
  PlanKey,
  type TenantFeaturesResponseDto,
} from '@stocket/types/features';
import { makeFeatureWriteWorkflows, type FeatureWriteRepository } from './write';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorUserId = 'admin-1';
const now = new Date('2026-03-01T00:00:00.000Z');

const featuresResponse = (
  overrides: Partial<TenantFeaturesResponseDto> = {},
): TenantFeaturesResponseDto => ({
  tenantId,
  planKey: PlanKey.GROWTH,
  source: EntitlementSource.MANUAL,
  features: {
    [FeatureKey.SMART_IMPORT]: true,
    [FeatureKey.ORDERS]: true,
  },
  overrides: [],
  updated_at: now,
  updated_by: actorUserId,
  ...overrides,
});

const makeRepository = (
  overrides: Partial<FeatureWriteRepository> = {},
): FeatureWriteRepository => ({
  tenantExists: () => Effect.succeed(true),
  upsertPlan: () => Effect.void,
  upsertOverride: () => Effect.void,
  deleteOverride: () => Effect.void,
  ...overrides,
});

describe('makeFeatureWriteWorkflows', () => {
  it.effect('updates a tenant plan, invalidates cache, and reloads features', () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      let upsertPlan:
        | {
            readonly tenantId: string;
            readonly planKey: PlanKey;
            readonly actorUserId: string;
          }
        | undefined;
      const workflows = makeFeatureWriteWorkflows({
        repository: makeRepository({
          tenantExists: (id) =>
            Effect.sync(() => {
              calls.push(`exists:${id}`);
              return true;
            }),
          upsertPlan: (id, planKey, actorId) =>
            Effect.sync(() => {
              calls.push('upsertPlan');
              upsertPlan = { tenantId: id, planKey, actorUserId: actorId };
            }),
        }),
        invalidateTenant: (id) =>
          Effect.sync(() => {
            calls.push(`invalidate:${id}`);
          }),
        loadFeaturesForTenant: (id) =>
          Effect.sync(() => {
            calls.push(`load:${id}`);
            return featuresResponse({ tenantId: id, planKey: PlanKey.GROWTH });
          }),
      });

      const result = yield* workflows.setTenantPlan(
        tenantId,
        { planKey: PlanKey.GROWTH },
        actorUserId,
      );

      expect(upsertPlan).toEqual({
        tenantId,
        planKey: PlanKey.GROWTH,
        actorUserId,
      });
      expect(calls).toEqual([
        `exists:${tenantId}`,
        'upsertPlan',
        `invalidate:${tenantId}`,
        `load:${tenantId}`,
      ]);
      expect(result.planKey).toBe(PlanKey.GROWTH);
    }),
  );

  it.effect('upserts a feature override and reloads features', () =>
    Effect.gen(function* () {
      const expiresAt = new Date('2026-04-01T00:00:00.000Z');
      let upsertOverride:
        | {
            readonly tenantId: string;
            readonly featureKey: FeatureKey;
            readonly enabled: boolean;
            readonly reason?: string | null;
            readonly expires_at?: Date | null;
            readonly actorUserId: string;
          }
        | undefined;
      const workflows = makeFeatureWriteWorkflows({
        repository: makeRepository({
          upsertOverride: (id, featureKey, input, actorId) =>
            Effect.sync(() => {
              upsertOverride = {
                tenantId: id,
                featureKey,
                enabled: input.enabled,
                reason: input.reason,
                expires_at: input.expires_at,
                actorUserId: actorId,
              };
            }),
        }),
        invalidateTenant: () => Effect.void,
        loadFeaturesForTenant: () => Effect.succeed(featuresResponse()),
      });

      yield* workflows.setFeatureOverride(
        tenantId,
        FeatureKey.SMART_IMPORT,
        {
          enabled: true,
          reason: 'Beta tenant',
          expires_at: expiresAt,
        },
        actorUserId,
      );

      expect(upsertOverride).toEqual({
        tenantId,
        featureKey: FeatureKey.SMART_IMPORT,
        enabled: true,
        reason: 'Beta tenant',
        expires_at: expiresAt,
        actorUserId,
      });
    }),
  );

  it.effect('deletes a feature override and reloads features', () =>
    Effect.gen(function* () {
      let deleted:
        | {
            readonly tenantId: string;
            readonly featureKey: FeatureKey;
          }
        | undefined;
      const workflows = makeFeatureWriteWorkflows({
        repository: makeRepository({
          deleteOverride: (id, featureKey) =>
            Effect.sync(() => {
              deleted = { tenantId: id, featureKey };
            }),
        }),
        invalidateTenant: () => Effect.void,
        loadFeaturesForTenant: () => Effect.succeed(featuresResponse()),
      });

      const result = yield* workflows.clearFeatureOverride(
        tenantId,
        FeatureKey.SMART_IMPORT,
      );

      expect(deleted).toEqual({
        tenantId,
        featureKey: FeatureKey.SMART_IMPORT,
      });
      expect(result.tenantId).toBe(tenantId);
    }),
  );

  it.effect('fails before writing when the tenant does not exist', () =>
    Effect.gen(function* () {
      let upsertCalled = false;
      let invalidateCalled = false;
      const workflows = makeFeatureWriteWorkflows({
        repository: makeRepository({
          tenantExists: () => Effect.succeed(false),
          upsertPlan: () =>
            Effect.sync(() => {
              upsertCalled = true;
            }),
        }),
        invalidateTenant: () =>
          Effect.sync(() => {
            invalidateCalled = true;
          }),
        loadFeaturesForTenant: () => Effect.succeed(featuresResponse()),
      });

      const error = yield* Effect.flip(
        workflows.setTenantPlan(
          tenantId,
          { planKey: PlanKey.GROWTH },
          actorUserId,
        ),
      );

      expect(error).toMatchObject({
        _tag: 'FeatureTenantNotFound',
        tenantId,
      });
      expect(upsertCalled).toBe(false);
      expect(invalidateCalled).toBe(false);
    }),
  );
});
