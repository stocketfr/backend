import {
  FeatureKey,
  type FeatureStates,
  PlanKey,
} from '@stocket/types/features';

export const DEFAULT_PLAN_KEY = PlanKey.FREE;

export const FEATURE_KEYS = [
  FeatureKey.SMART_IMPORT,
  FeatureKey.ORDERS,
] as const;

export const PLAN_FEATURE_DEFAULTS: Record<PlanKey, FeatureStates> = {
  [PlanKey.FREE]: {
    [FeatureKey.SMART_IMPORT]: false,
    [FeatureKey.ORDERS]: true,
  },
  [PlanKey.BASE]: {
    [FeatureKey.SMART_IMPORT]: false,
    [FeatureKey.ORDERS]: true,
  },
  [PlanKey.GROWTH]: {
    [FeatureKey.SMART_IMPORT]: true,
    [FeatureKey.ORDERS]: true,
  },
  [PlanKey.ENTERPRISE]: {
    [FeatureKey.SMART_IMPORT]: true,
    [FeatureKey.ORDERS]: true,
  },
};

export const featuresForPlan = (planKey: PlanKey): FeatureStates => ({
  ...PLAN_FEATURE_DEFAULTS[planKey],
});

