import { Effect } from 'effect';
import type {
  FeatureKey,
  TenantFeaturesResponseDto,
} from '@stocket/types/features';
import { requireRequestTenantId } from '../../platform/tenancy/tenant-context';
import { FeatureNotEnabled } from './features.errors';

interface FeatureAccessOptions<LoadError, LoadContext> {
  readonly getFeaturesForTenant: (
    tenantId: string,
  ) => Effect.Effect<TenantFeaturesResponseDto, LoadError, LoadContext>;
}

export const makeFeatureAccess = <LoadError, LoadContext>({
  getFeaturesForTenant,
}: FeatureAccessOptions<LoadError, LoadContext>) => {
  const requireFeature = (featureKey: FeatureKey) =>
    Effect.gen(function* () {
      const tenantId = yield* requireRequestTenantId;
      const { features } = yield* getFeaturesForTenant(tenantId);
      if (features[featureKey]) {
        return;
      }
      return yield* Effect.fail(
        new FeatureNotEnabled({
          featureKey,
          messageKey: 'features.notEnabled',
        }),
      );
    });

  return { requireFeature };
};
