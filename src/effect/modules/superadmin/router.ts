import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { requireSuperAdmin } from '../../platform/auth/authorization';
import { BetterAuthHeaders } from '../../platform/auth/better-auth';
import { respondJson } from '../../platform/http/errors';
import { getRequestHeaders } from '../../platform/http/session';
import {
  CreateSuperAdminTenantSchema,
  UpdateSuperAdminTenantSchema,
} from '@stocket/types/superadmin';
import { getRequestContext } from '../../platform/http/request-context';
import { SuperAdminService } from './service';

const TenantPathParamsSchema = Schema.Struct({
  tenantId: Schema.UUID,
});

export const superAdminRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/me',
    Effect.gen(function* () {
      const session = yield* requireSuperAdmin;
      const superAdminService = yield* SuperAdminService;
      return yield* respondJson(superAdminService.me(session));
    }),
  ),
  HttpRouter.get(
    '/tenants',
    Effect.gen(function* () {
      yield* requireSuperAdmin;
      const superAdminService = yield* SuperAdminService;
      return yield* respondJson(superAdminService.listTenants());
    }),
  ),
  HttpRouter.post(
    '/tenants',
    Effect.gen(function* () {
      const session = yield* requireSuperAdmin;
      const dto = yield* HttpServerRequest.schemaBodyJson(
        CreateSuperAdminTenantSchema,
      );
      const request = yield* HttpServerRequest.HttpServerRequest;
      const requestContext = yield* getRequestContext;
      const requestHeaders = yield* getRequestHeaders;
      const superAdminService = yield* SuperAdminService;
      const userAgent = request.headers['user-agent'];

      return yield* respondJson(
        superAdminService
          .createTenant(dto, {
            userId: session.user.id,
            ipAddress: requestContext.ip,
            userAgent: typeof userAgent === 'string' ? userAgent : null,
          })
          .pipe(Effect.provideService(BetterAuthHeaders, requestHeaders)),
        { status: 201 },
      );
    }),
  ),
  HttpRouter.get(
    '/tenants/:tenantId/features',
    Effect.gen(function* () {
      yield* requireSuperAdmin;
      const { tenantId } = yield* HttpRouter.schemaPathParams(
        TenantPathParamsSchema,
      );
      const superAdminService = yield* SuperAdminService;
      return yield* respondJson(superAdminService.getTenantFeatures(tenantId));
    }),
  ),
  HttpRouter.put(
    '/tenants/:tenantId',
    Effect.gen(function* () {
      const session = yield* requireSuperAdmin;
      const { tenantId } = yield* HttpRouter.schemaPathParams(
        TenantPathParamsSchema,
      );
      const dto = yield* HttpServerRequest.schemaBodyJson(
        UpdateSuperAdminTenantSchema,
      );
      const request = yield* HttpServerRequest.HttpServerRequest;
      const requestContext = yield* getRequestContext;
      const superAdminService = yield* SuperAdminService;
      const userAgent = request.headers['user-agent'];

      return yield* respondJson(
        superAdminService.updateTenant(tenantId, dto, {
          userId: session.user.id,
          ipAddress: requestContext.ip,
          userAgent: typeof userAgent === 'string' ? userAgent : null,
        }),
      );
    }),
  ),
  HttpRouter.prefixAll('/superadmin'),
);
