import { readFile } from 'node:fs/promises';
import { HttpRouter, HttpServerRequest, Multipart } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { requireSuperAdmin } from '../../platform/auth/authorization';
import { BetterAuthHeaders } from '../../platform/auth/better-auth';
import { respondJson } from '../../platform/http/errors';
import { getRequestHeaders } from '../../platform/http/session';
import { CreateSuperAdminTenantSchema } from '@stocket/types/superadmin';
import { getRequestContext } from '../../platform/http/request-context';
import { SuperAdminTenantImportReadFailed } from './superadmin.errors';
import { SuperAdminService } from './service';

const CreateSuperAdminTenantUploadSchema = Schema.Struct({
  name: Schema.String,
  slug: Schema.String,
  admin_name: Schema.String,
  admin_email: Schema.String,
  admin_password: Schema.String,
  import_file: Schema.optional(Multipart.SingleFileSchema),
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
      const upload = yield* HttpServerRequest.schemaBodyMultipart(
        CreateSuperAdminTenantUploadSchema,
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
      const uploadedImportFile = upload.import_file;
      const importFile = uploadedImportFile
        ? yield* Effect.tryPromise({
            try: async () => ({
              filename: uploadedImportFile.name,
              content: (await readFile(uploadedImportFile.path)).toString(
                'utf8',
              ),
            }),
            catch: (cause) =>
              new SuperAdminTenantImportReadFailed({
                filename: uploadedImportFile.name,
                cause,
                messageKey: 'superadmin.tenantImportReadFailed',
              }),
          })
        : undefined;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const requestContext = yield* getRequestContext;
      const requestHeaders = yield* getRequestHeaders;
      const superAdminService = yield* SuperAdminService;
      const userAgent = request.headers['user-agent'];

      return yield* respondJson(
        superAdminService
          .createTenant(
            dto,
            {
              userId: session.user.id,
              ipAddress: requestContext.ip,
              userAgent: typeof userAgent === 'string' ? userAgent : null,
            },
            importFile ? { importFile } : undefined,
          )
          .pipe(Effect.provideService(BetterAuthHeaders, requestHeaders)),
        { status: 201 },
      );
    }),
  ),
  HttpRouter.prefixAll('/superadmin'),
);
