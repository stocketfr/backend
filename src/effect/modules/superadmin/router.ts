import { readFile } from 'node:fs/promises';
import { HttpRouter, HttpServerRequest, Multipart } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { requireSuperAdmin } from '../../platform/auth/authorization';
import { BetterAuthHeaders } from '../../platform/auth/better-auth';
import { respondJson } from '../../platform/http/errors';
import { getRequestHeaders } from '../../platform/http/session';
import { CreateSuperAdminTenantSchema } from '@stocket/types/superadmin';
import {
  FeatureKeySchema,
  UpdateTenantFeatureOverrideSchema,
  UpdateTenantPlanSchema,
} from '@stocket/types/features';
import { getRequestContext } from '../../platform/http/request-context';
import { TenantImportInvalid } from './superadmin.errors';
import { SuperAdminService } from './service';

const TenantPathParams = Schema.Struct({ tenantId: Schema.UUID });
const TenantFeaturePathParams = Schema.Struct({
  tenantId: Schema.UUID,
  featureKey: FeatureKeySchema,
});
const CreateTenantUploadSchema = Schema.Struct({
  name: Schema.String,
  slug: Schema.String,
  admin_name: Schema.String,
  admin_email: Schema.String,
  admin_password: Schema.String,
  import_file: Schema.optional(Multipart.SingleFileSchema),
});

const readCreateTenantUpload = Effect.gen(function* () {
  const upload = yield* HttpServerRequest.schemaBodyMultipart(
    CreateTenantUploadSchema,
  );
  const dto = yield* Schema.decodeUnknown(CreateSuperAdminTenantSchema)({
    name: upload.name,
    slug: upload.slug,
    admin: {
      name: upload.admin_name,
      email: upload.admin_email,
      password: upload.admin_password,
    },
  });

  const importFile = upload.import_file;
  if (!importFile) {
    return { dto };
  }

  const buffer = yield* Effect.tryPromise({
    try: () => readFile(importFile.path),
    catch: (cause) =>
      new TenantImportInvalid({
        details: 'Failed to read uploaded product import file.',
        cause,
        messageKey: 'superadmin.tenantImportInvalid',
        messageArgs: {
          details: 'Failed to read uploaded product import file.',
        },
      }),
  });

  return {
    dto,
    productImport: {
      filename: importFile.name,
      content: buffer.toString('utf8'),
    },
  };
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
      const { dto, productImport } = yield* readCreateTenantUpload;
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
            requestContext,
          },
          productImport,
        ).pipe(Effect.provideService(BetterAuthHeaders, requestHeaders)),
        { status: 201 },
      );
    }),
  ),
  HttpRouter.get(
    '/tenants/:tenantId/features',
    Effect.gen(function* () {
      yield* requireSuperAdmin;
      const { tenantId } = yield* HttpRouter.schemaPathParams(TenantPathParams);
      const superAdminService = yield* SuperAdminService;
      return yield* respondJson(superAdminService.getTenantFeatures(tenantId));
    }),
  ),
  HttpRouter.put(
    '/tenants/:tenantId/plan',
    Effect.gen(function* () {
      const session = yield* requireSuperAdmin;
      const { tenantId } = yield* HttpRouter.schemaPathParams(TenantPathParams);
      const dto = yield* HttpServerRequest.schemaBodyJson(
        UpdateTenantPlanSchema,
      );
      const superAdminService = yield* SuperAdminService;
      return yield* respondJson(
        superAdminService.updateTenantPlan(tenantId, dto, session.user.id),
      );
    }),
  ),
  HttpRouter.put(
    '/tenants/:tenantId/features/:featureKey',
    Effect.gen(function* () {
      const session = yield* requireSuperAdmin;
      const { tenantId, featureKey } =
        yield* HttpRouter.schemaPathParams(TenantFeaturePathParams);
      const dto = yield* HttpServerRequest.schemaBodyJson(
        UpdateTenantFeatureOverrideSchema,
      );
      const superAdminService = yield* SuperAdminService;
      return yield* respondJson(
        superAdminService.updateTenantFeatureOverride(
          tenantId,
          featureKey,
          dto,
          session.user.id,
        ),
      );
    }),
  ),
  HttpRouter.del(
    '/tenants/:tenantId/features/:featureKey',
    Effect.gen(function* () {
      yield* requireSuperAdmin;
      const { tenantId, featureKey } =
        yield* HttpRouter.schemaPathParams(TenantFeaturePathParams);
      const superAdminService = yield* SuperAdminService;
      return yield* respondJson(
        superAdminService.clearTenantFeatureOverride(tenantId, featureKey),
      );
    }),
  ),
  HttpRouter.prefixAll('/superadmin'),
);
