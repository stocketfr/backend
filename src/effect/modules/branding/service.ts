import { Effect } from 'effect';
import type {
  BrandingResponseDto,
  UpdateBrandingDto,
} from '@stocket/types/branding';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import {
  DEFAULT_TENANT_ID,
  getRequestTenantId,
  requireRequestTenantId,
  type TenantNotResolved,
} from '../../platform/tenancy/tenant-context';
import {
  DEFAULT_BRANDING,
  POWERED_BY,
} from './branding.constants';
import { toBrandingResponse } from './branding.utils';
import { BrandingInfrastructureError } from './branding.errors';
import { BrandingRepository } from './repository';

export class BrandingService extends Effect.Service<BrandingService>()(
  '@stocket/effect/branding/BrandingService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* BrandingRepository;
      const trace = makeServiceTracer({
        serviceName: 'BrandingService',
        module: 'branding',
        layer: 'service',
      });

      const get = (): Effect.Effect<
        BrandingResponseDto,
        BrandingInfrastructureError
      > =>
        Effect.gen(function* () {
          const tenantId = (yield* getRequestTenantId) ?? DEFAULT_TENANT_ID;
          const settings = yield* repository.findSettings(tenantId);
          return settings
            ? toBrandingResponse(settings)
            : {
                ...DEFAULT_BRANDING,
                powered_by: POWERED_BY,
                updated_at: new Date(),
              };
        }).pipe(trace.span('get'));

      const update = (
        dto: UpdateBrandingDto,
        userId: string,
      ): Effect.Effect<
        BrandingResponseDto,
        BrandingInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* requireRequestTenantId;
          yield* repository.upsertSettings(tenantId, dto, userId);

          const settings = yield* repository.findSettings(tenantId);
          if (!settings) {
            return yield* Effect.fail(
              new BrandingInfrastructureError({
                action: 'load persisted branding settings',
                messageKey: 'branding.repositoryFailed',
              }),
            );
          }

          return toBrandingResponse(settings);
        }).pipe(
          trace.span('update', { attributes: { userId } }),
        );

      return { get, update };
    }),
    dependencies: [BrandingRepository.Default],
  },
) {}
