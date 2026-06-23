import {
  EntitlementSource,
  type FeatureStates,
  type TenantFeaturesResponseDto,
} from '@stocket/types/features';
import type {
  TenantEntitlementProfileRow,
  TenantFeatureOverrideRow,
} from './repository';
import { DEFAULT_PLAN_KEY, featuresForPlan } from './registry';

const isActiveOverride = (
  override: TenantFeatureOverrideRow,
  now: Date,
): boolean => !override.expires_at || override.expires_at > now;

const toOverrideResponse = (override: TenantFeatureOverrideRow) => ({
  featureKey: override.feature_key,
  enabled: override.enabled,
  reason: override.reason,
  expires_at: override.expires_at,
  updated_at: override.updated_at,
  updated_by: override.updated_by,
});

export const buildTenantFeaturesResponse = (
  tenantId: string,
  profile: TenantEntitlementProfileRow | null,
  overrides: TenantFeatureOverrideRow[],
): TenantFeaturesResponseDto => {
  const planKey = profile?.plan_key ?? DEFAULT_PLAN_KEY;
  const features: FeatureStates = featuresForPlan(planKey);
  const now = new Date();

  for (const override of overrides) {
    if (isActiveOverride(override, now)) {
      features[override.feature_key] = override.enabled;
    }
  }

  return {
    tenantId,
    planKey,
    source: profile?.source ?? EntitlementSource.SYSTEM,
    features,
    overrides: overrides.map(toOverrideResponse),
    updated_at: profile?.updated_at ?? null,
    updated_by: profile?.updated_by ?? null,
  };
};
