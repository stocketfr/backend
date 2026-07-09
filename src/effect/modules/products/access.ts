import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { FeatureKey } from '@stocket/types/features';
import { requirePermission } from '../../platform/auth/authorization';
import { FeaturesService } from '../features/service';

export const requireSmartImportFeature = Effect.flatMap(
  FeaturesService,
  (features) => features.requireFeature(FeatureKey.SMART_IMPORT),
);

export const requireProductImportAccess = Effect.gen(function* () {
  yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
  yield* requirePermission(Resource.LOCATIONS, Permission.WRITE);
  yield* requirePermission(Resource.INVENTORY, Permission.WRITE);
  yield* requireSmartImportFeature;
});
