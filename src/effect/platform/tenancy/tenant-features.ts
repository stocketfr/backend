import { Effect } from 'effect';
import { desc, eq } from 'drizzle-orm';
import {
  EntitlementSource,
  FeatureKey,
  PlanKey,
  type FeatureStates,
  type TenantFeatureOverrideResponseDto,
  type TenantFeaturesResponseDto,
} from '@stocket/types/features';
import { DrizzleDatabase } from '../db/drizzle';
import { tenantFeatureOverrides } from '../db/schema';
import { InternalError } from '../effect/domain-errors';

export class TenantFeaturesRepositoryError extends InternalError(
  'TenantFeaturesRepositoryError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}

export interface TenantFeatureOverrideRow {
  readonly featureKey: string;
  readonly enabled: boolean;
  readonly expiresAt: Date | null;
  readonly updatedAt: Date;
  readonly updatedBy: string | null;
}

export const FEATURE_KEYS = Object.values(FeatureKey) as FeatureKey[];
export const DEFAULT_FEATURE_STATES: FeatureStates = {
  [FeatureKey.SMART_IMPORT]: false,
  [FeatureKey.ORDERS]: true,
};

const isFeatureKey = (value: string): value is FeatureKey =>
  FEATURE_KEYS.includes(value as FeatureKey);

export const normalizeFeatureStates = (
  features: Partial<FeatureStates> | null | undefined,
): FeatureStates => ({
  ...DEFAULT_FEATURE_STATES,
  ...features,
});

export const resolveFeatureStates = (
  overrides: ReadonlyArray<TenantFeatureOverrideRow>,
  now = new Date(),
): FeatureStates => {
  const features = normalizeFeatureStates(undefined);

  for (const override of overrides) {
    if (!isFeatureKey(override.featureKey)) {
      continue;
    }
    if (override.expiresAt && override.expiresAt <= now) {
      continue;
    }
    features[override.featureKey] = override.enabled;
  }

  return features;
};

const toOverrideDto = (
  row: TenantFeatureOverrideRow,
): TenantFeatureOverrideResponseDto => ({
  featureKey: row.featureKey as FeatureKey,
  enabled: row.enabled,
  reason: null,
  expires_at: row.expiresAt,
  updated_at: row.updatedAt,
  updated_by: row.updatedBy,
});

const latestOverride = (
  overrides: ReadonlyArray<TenantFeatureOverrideRow>,
): TenantFeatureOverrideRow | null =>
  overrides.reduce<TenantFeatureOverrideRow | null>(
    (latest, override) =>
      latest === null || override.updatedAt > latest.updatedAt
        ? override
        : latest,
    null,
  );

export class TenantFeaturesService extends Effect.Service<TenantFeaturesService>()(
  '@stocket/effect/tenancy/TenantFeaturesService',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;

      const listOverrides = (tenantId: string) =>
        Effect.tryPromise({
          try: async () =>
            await db
              .select({
                featureKey: tenantFeatureOverrides.feature_key,
                enabled: tenantFeatureOverrides.enabled,
                expiresAt: tenantFeatureOverrides.expires_at,
                updatedAt: tenantFeatureOverrides.updated_at,
                updatedBy: tenantFeatureOverrides.updated_by,
              })
              .from(tenantFeatureOverrides)
              .where(eq(tenantFeatureOverrides.tenant_id, tenantId))
              .orderBy(desc(tenantFeatureOverrides.updated_at)),
          catch: (cause) =>
            new TenantFeaturesRepositoryError({
              action: 'list tenant feature overrides',
              cause,
              messageKey: 'tenantFeatures.repositoryFailed',
            }),
        });

      const getEffectiveFeatures = (tenantId: string) =>
        Effect.map(listOverrides(tenantId), (rows) =>
          resolveFeatureStates(rows),
        );

      const getTenantFeatures = (tenantId: string) =>
        Effect.map(listOverrides(tenantId), (rows) => {
          const now = new Date();
          const latest = latestOverride(rows);
          const activeOverrides = rows.filter(
            (row) => !row.expiresAt || row.expiresAt > now,
          );

          return {
            tenantId,
            planKey: PlanKey.FREE,
            source:
              activeOverrides.length > 0
                ? EntitlementSource.MANUAL
                : EntitlementSource.SYSTEM,
            features: resolveFeatureStates(rows, now),
            overrides: rows
              .filter((row) => isFeatureKey(row.featureKey))
              .map(toOverrideDto),
            updated_at: latest?.updatedAt ?? null,
            updated_by: latest?.updatedBy ?? null,
          } satisfies TenantFeaturesResponseDto;
        });

      return {
        listOverrides,
        getEffectiveFeatures,
        getTenantFeatures,
      };
    }),
  },
) {}
