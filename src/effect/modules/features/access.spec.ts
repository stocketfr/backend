import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  EntitlementSource,
  FeatureKey,
  PlanKey,
  type TenantFeaturesResponseDto,
} from '@stocket/types/features';
import { CurrentRequestContext } from '../../platform/http/request-context';
import { makeFeatureAccess } from './access';

const tenantId = '00000000-0000-4000-8000-000000000001';
const requestContext = {
  requestId: '00000000-0000-4000-8000-000000000099',
  path: '/api/v1/features',
  method: 'GET' as const,
  ip: null,
  locale: 'en' as const,
  tenantId,
};

const featuresResponse = (
  smartImportEnabled: boolean,
): TenantFeaturesResponseDto => ({
  tenantId,
  planKey: PlanKey.FREE,
  source: EntitlementSource.SYSTEM,
  features: {
    [FeatureKey.SMART_IMPORT]: smartImportEnabled,
    [FeatureKey.ORDERS]: true,
  },
  overrides: [],
  updated_at: null,
  updated_by: null,
});

const provideRequest = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.provideService(CurrentRequestContext, requestContext));

describe('makeFeatureAccess', () => {
  it.effect('succeeds when the requested feature is enabled', () =>
    provideRequest(
      makeFeatureAccess({
        getFeaturesForTenant: () => Effect.succeed(featuresResponse(true)),
      }).requireFeature(FeatureKey.SMART_IMPORT),
    ),
  );

  it.effect('fails when the requested feature is disabled', () =>
    provideRequest(
      Effect.gen(function* () {
        const access = makeFeatureAccess({
          getFeaturesForTenant: () => Effect.succeed(featuresResponse(false)),
        });

        const error = yield* Effect.flip(
          access.requireFeature(FeatureKey.SMART_IMPORT),
        );

        expect(error).toMatchObject({
          _tag: 'FeatureNotEnabled',
          featureKey: FeatureKey.SMART_IMPORT,
        });
      }),
    ),
  );
});
