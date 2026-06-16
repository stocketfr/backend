import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect } from 'effect';
import { requireSuperAdmin } from '../../platform/auth/authorization';
import { respondJson } from '../../platform/http/errors';
import { CreateSuperAdminTenantSchema } from '@stocket/types/superadmin';
import { getRequestContext } from '../../platform/http/request-context';
import { SuperAdminService } from './service';

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
      const superAdminService = yield* SuperAdminService;
      const userAgent = request.headers['user-agent'];

      return yield* respondJson(
        superAdminService.createTenant(dto, {
          userId: session.user.id,
          ipAddress: requestContext.ip,
          userAgent: typeof userAgent === 'string' ? userAgent : null,
        }),
        { status: 201 },
      );
    }),
  ),
  HttpRouter.prefixAll('/superadmin'),
);
