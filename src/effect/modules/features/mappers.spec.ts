import { describe, expect, it } from '@effect/vitest';
import {
  EntitlementSource,
  FeatureKey,
  PlanKey,
} from '@stocket/types/features';
import { buildTenantFeaturesResponse } from './mappers';
import type {
  TenantEntitlementProfileRow,
  TenantFeatureOverrideRow,
} from './types';

const tenantId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-01-01T00:00:00.000Z');

const profile = (
  planKey: PlanKey,
  overrides: Partial<TenantEntitlementProfileRow> = {},
): TenantEntitlementProfileRow => ({
  tenant_id: tenantId,
  plan_key: planKey,
  source: EntitlementSource.MANUAL,
  updated_by: 'admin-1',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const override = (
  enabled: boolean,
  expiresAt: Date | null,
): TenantFeatureOverrideRow => ({
  id: '00000000-0000-4000-8000-000000000002',
  tenant_id: tenantId,
  feature_key: FeatureKey.SMART_IMPORT,
  enabled,
  reason: 'Beta tenant',
  expires_at: expiresAt,
  updated_by: 'admin-1',
  created_at: now,
  updated_at: now,
});

describe('feature mappers', () => {
  it('uses default free-plan features when no profile exists', () => {
    const result = buildTenantFeaturesResponse(tenantId, null, []);

    expect(result).toMatchObject({
      tenantId,
      planKey: PlanKey.FREE,
      source: EntitlementSource.SYSTEM,
      features: {
        [FeatureKey.SMART_IMPORT]: false,
        [FeatureKey.ORDERS]: true,
      },
      updated_at: null,
      updated_by: null,
    });
  });

  it('applies active overrides and preserves override response metadata', () => {
    const result = buildTenantFeaturesResponse(tenantId, profile(PlanKey.FREE), [
      override(true, new Date('2030-01-01T00:00:00.000Z')),
    ]);

    expect(result.features[FeatureKey.SMART_IMPORT]).toBe(true);
    expect(result.overrides).toEqual([
      {
        featureKey: FeatureKey.SMART_IMPORT,
        enabled: true,
        reason: 'Beta tenant',
        expires_at: new Date('2030-01-01T00:00:00.000Z'),
        updated_at: now,
        updated_by: 'admin-1',
      },
    ]);
  });

  it('ignores expired overrides for effective feature states', () => {
    const result = buildTenantFeaturesResponse(tenantId, profile(PlanKey.GROWTH), [
      override(false, new Date('2020-01-01T00:00:00.000Z')),
    ]);

    expect(result.features[FeatureKey.SMART_IMPORT]).toBe(true);
  });
});
