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
import { toBrandingResponse, toDefaultBrandingResponse } from './mappers';
import type { BrandingInfrastructureError } from './branding.errors';
import { BrandingRepository } from './repository';
import { makeBrandingWriteWorkflows } from './write';

export class BrandingService extends Effect.Service<BrandingService>()(
  '@stocket/effect/branding/BrandingService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* BrandingRepository;
      const writeWorkflows = makeBrandingWriteWorkflows({ repository });
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
            : toDefaultBrandingResponse();
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
          return yield* writeWorkflows.update(tenantId, dto, userId);
        }).pipe(trace.span('update', { attributes: { userId } }));

      return { get, update };
    }),
    dependencies: [BrandingRepository.Default],
  },
) {}
