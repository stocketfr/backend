import { Effect } from 'effect';
import { FeatureKey } from '@stocket/types/features';
import { FeaturesService } from '../features/service';

export const requireOrdersFeature = Effect.flatMap(
  FeaturesService,
  (features) => features.requireFeature(FeatureKey.ORDERS),
);
