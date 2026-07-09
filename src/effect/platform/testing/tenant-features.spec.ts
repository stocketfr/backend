import { FeatureKey } from '@stocket/types/features';
import {
  DEFAULT_FEATURE_STATES,
  normalizeFeatureStates,
  resolveFeatureStates,
} from '../tenancy/tenant-features';

describe('tenant feature resolution', () => {
  it('normalizes null feature overrides to shared defaults', () => {
    expect(normalizeFeatureStates(null)).toEqual(DEFAULT_FEATURE_STATES);
  });

  it('returns shared defaults with no overrides', () => {
    expect(resolveFeatureStates([])).toEqual(DEFAULT_FEATURE_STATES);
  });

  it('applies active overrides by feature key', () => {
    expect(
      resolveFeatureStates([
        {
          featureKey: FeatureKey.SMART_IMPORT,
          enabled: true,
          expiresAt: null,
          updatedAt: new Date('2026-06-22T10:00:00.000Z'),
          updatedBy: 'superadmin-1',
        },
      ]),
    ).toEqual({
      ...DEFAULT_FEATURE_STATES,
      [FeatureKey.SMART_IMPORT]: true,
    });
  });

  it('ignores expired overrides', () => {
    expect(
      resolveFeatureStates(
        [
          {
            featureKey: FeatureKey.ORDERS,
            enabled: false,
            expiresAt: new Date('2026-06-21T10:00:00.000Z'),
            updatedAt: new Date('2026-06-20T10:00:00.000Z'),
            updatedBy: 'superadmin-1',
          },
        ],
        new Date('2026-06-22T10:00:00.000Z'),
      ),
    ).toEqual(DEFAULT_FEATURE_STATES);
  });
});
