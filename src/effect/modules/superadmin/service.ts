import { Effect } from 'effect';
import type {
  CreateSuperAdminTenantInput,
  SuperAdminCreateTenantResponse,
  SuperAdminMeResponse,
  SuperAdminTenantListResponse,
} from '@stocket/types/superadmin';
import type {
  ProductImportPreviewDto,
  ProductImportResultDto,
} from '@stocket/types/products';
import type {
  FeatureKey,
  UpdateTenantFeatureOverride,
  UpdateTenantPlan,
} from '@stocket/types/features';
import {
  hostnameForTenantSlug,
  isReservedTenantSlug,
  isValidTenantSlug,
} from '../../platform/tenancy/host';
import type { UserSession } from '../../platform/auth/user-session';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { makeTryAsync } from '../../platform/effect/try-async';
import { BetterAuth, BetterAuthHeaders } from '../../platform/auth/better-auth';
import { type LogPayload } from '../../platform/observability/messages';
import { UsersRepository } from '../users/repository';
import { tenantWelcomeOrigin, welcomeRedirectUrl } from '../users/users.utils';
import {
  InvalidTenantSlug,
  ReservedTenantSlug,
  SuperAdminRepositoryError,
  TenantImportInvalid,
  TenantHostnameAlreadyExists,
  TenantNotFound,
  TenantSlugAlreadyExists,
} from './superadmin.errors';
import { SuperAdminRepository } from './repository';
import { FeaturesService } from '../features/service';
import { ProductImportService } from '../products/import/service';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../../platform/http/request-context';
import { pgUniqueViolationConstraintName } from '../../platform/db/pg-errors';

interface BetterAuthCreateUserResponse {
  readonly user: { readonly id: string };
}

interface BetterAuthCreateUserBody {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly data?: { readonly emailVerified: boolean };
}

interface CreateTenantActor {
  readonly userId: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly requestContext?: RequestContext;
}

interface CreateTenantProductImport {
  readonly filename: string;
  readonly content: string;
}

const mapCreateTenantError = (
  error: SuperAdminRepositoryError,
  slug: string,
  hostname: string,
) => {
  const constraint = pgUniqueViolationConstraintName(error);
  if (constraint === 'organization_slug_unique') {
    return new TenantSlugAlreadyExists({
      slug,
      messageKey: 'superadmin.tenantSlugAlreadyExists',
    });
  }

  if (
    constraint === 'tenant_domains_hostname_unique' ||
    constraint === 'tenant_domains_hostname_key'
  ) {
    return new TenantHostnameAlreadyExists({
      hostname,
      messageKey: 'superadmin.tenantHostnameAlreadyExists',
    });
  }

  return error;
};

const makeTenantImportInvalid = (details: string, cause?: unknown) =>
  new TenantImportInvalid({
    details,
    cause,
    messageKey: 'superadmin.tenantImportInvalid',
    messageArgs: { details },
  });

const formatImportCause = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim() !== '') {
    return cause.message;
  }

  if (
    cause !== null &&
    typeof cause === 'object' &&
    !Array.isArray(cause) &&
    'message' in cause &&
    typeof cause.message === 'string' &&
    cause.message.trim() !== ''
  ) {
    return cause.message;
  }

  return 'Product import failed.';
};

const formatPreviewErrors = (preview: ProductImportPreviewDto) => {
  const rowErrors = preview.inventoryPreviews
    .filter(
      (item) =>
        item.reason === 'Missing SKU or name' || item.action === 'conflict',
    )
    .map((item) => `Row ${item.row}: ${item.reason ?? item.action}`);

  if (rowErrors.length > 0) {
    return rowErrors.join('; ');
  }

  return preview.warnings
    .filter((warning) => warning.severity === 'error')
    .map((warning) => warning.message)
    .join('; ');
};

const formatImportResultErrors = (result: ProductImportResultDto) =>
  result.errors.map((error) => `Row ${error.row}: ${error.error}`).join('; ');

const tryAsync = makeTryAsync(
  (action, cause) =>
    new SuperAdminRepositoryError({
      action,
      cause,
      messageKey: 'superadmin.repositoryFailed',
    }),
);

export class SuperAdminService extends Effect.Service<SuperAdminService>()(
  '@stocket/effect/superadmin/SuperAdminService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* SuperAdminRepository;
      const usersRepository = yield* UsersRepository;
      const betterAuth = yield* BetterAuth;
      const featuresService = yield* FeaturesService;
      const productImportService = yield* ProductImportService;
      const trace = makeServiceTracer({
        serviceName: 'SuperAdminService',
        module: 'superadmin',
        layer: 'service',
        entityType: 'tenant',
      });
      const requestTenantAdminWelcomeEmail = (
        email: string,
        hostname: string,
      ) =>
        Effect.gen(function* () {
          const requestHeaders = yield* BetterAuthHeaders;
          const tenantOrigin = tenantWelcomeOrigin(
            hostname,
            requestHeaders.get('origin'),
          );
          const redirectTo = welcomeRedirectUrl(tenantOrigin);
          const headers = new Headers(requestHeaders);
          headers.set('origin', tenantOrigin);

          yield* Effect.tryPromise(() =>
            betterAuth.api.requestPasswordReset({
              body: { email, redirectTo },
              headers,
              request: new Request(redirectTo, { headers }),
            }),
          );
        }).pipe(
          Effect.catchAll((cause) =>
            Effect.logError({
              messageKey: 'email.welcomeRequestFailed',
              to: email,
              cause,
            } satisfies LogPayload),
          ),
        );

      const validateProductImport = (
        productImport: CreateTenantProductImport,
      ) =>
        productImportService
          .previewCsvContent({ content: productImport.content })
          .pipe(
            Effect.mapError((cause) =>
              makeTenantImportInvalid(formatImportCause(cause), cause),
            ),
            Effect.flatMap((preview) => {
              const details = formatPreviewErrors(preview);
              if (details) {
                return Effect.fail(makeTenantImportInvalid(details, preview));
              }
              return Effect.succeed(productImport);
            }),
          );

      const tenantImportRequestContext = (
        actor: CreateTenantActor,
        created: SuperAdminCreateTenantResponse,
      ): RequestContext => ({
        requestId:
          actor.requestContext?.requestId ??
          `00000000-0000-4000-8000-${created.tenant.id.slice(-12)}`,
        path: actor.requestContext?.path ?? '/api/v1/superadmin/tenants',
        method: actor.requestContext?.method ?? 'POST',
        ip: actor.ipAddress ?? actor.requestContext?.ip ?? null,
        locale: actor.requestContext?.locale ?? 'en',
        tenantId: created.tenant.id,
        tenantName: created.tenant.name,
        tenantSlug: created.tenant.slug,
      });

      const importProductsForTenant = (
        created: SuperAdminCreateTenantResponse,
        productImport: CreateTenantProductImport,
        actor: CreateTenantActor,
      ) =>
        productImportService
          .importFromCsvContent({
            content: productImport.content,
            userId: created.admin.id,
          })
          .pipe(
            Effect.provideService(
              CurrentRequestContext,
              tenantImportRequestContext(actor, created),
            ),
            Effect.mapError((cause) =>
              makeTenantImportInvalid(formatImportCause(cause), cause),
            ),
            Effect.flatMap((result) => {
              const details = formatImportResultErrors(result);
              if (details) {
                return Effect.fail(makeTenantImportInvalid(details, result));
              }
              return Effect.succeed(result);
            }),
          );

      const me = trace.traced('me', (session: UserSession) =>
        Effect.succeed({
          id: session.user.id,
          email: session.user.email ?? '',
          name: session.user.name ?? '',
          isSuperAdmin: true,
        } satisfies SuperAdminMeResponse),
      );

      const listTenants = trace.traced('listTenants', () =>
        Effect.map(
          repository.listTenants(),
          (rows) =>
            ({
              data: rows.map((row) => ({
                id: row.id,
                name: row.name,
                slug: row.slug,
                primaryHostname: row.primaryHostname,
                createdAt: row.createdAt.toISOString(),
              })),
            }) satisfies SuperAdminTenantListResponse,
        ),
      );

      const createTenant = trace.traced(
        'createTenant',
        (
          input: CreateSuperAdminTenantInput,
          actor: CreateTenantActor,
          productImport?: CreateTenantProductImport,
        ) =>
          Effect.gen(function* () {
            const slug = input.slug.trim().toLowerCase();
            if (!isValidTenantSlug(slug)) {
              return yield* Effect.fail(
                new InvalidTenantSlug({
                  slug: input.slug,
                  messageKey: 'superadmin.invalidTenantSlug',
                }),
              );
            }

            if (isReservedTenantSlug(slug)) {
              return yield* Effect.fail(
                new ReservedTenantSlug({
                  slug,
                  messageKey: 'superadmin.reservedTenantSlug',
                }),
              );
            }

            const hostname = hostnameForTenantSlug(slug);
            if (yield* repository.tenantSlugExists(slug)) {
              return yield* Effect.fail(
                new TenantSlugAlreadyExists({
                  slug,
                  messageKey: 'superadmin.tenantSlugAlreadyExists',
                }),
              );
            }

            if (yield* repository.tenantHostnameExists(hostname)) {
              return yield* Effect.fail(
                new TenantHostnameAlreadyExists({
                  hostname,
                  messageKey: 'superadmin.tenantHostnameAlreadyExists',
                }),
              );
            }

            const validatedProductImport = productImport
              ? yield* validateProductImport(productImport)
              : undefined;

            const normalizedEmail = input.admin.email.trim().toLowerCase();
            const adminName = input.admin.name.trim();

            const existing =
              yield* repository.findBetterAuthUserByLoweredEmail(
                normalizedEmail,
              );

            let adminUserId: string;
            let adminCreatedHere: boolean;
            if (existing) {
              adminUserId = existing.id;
              adminCreatedHere = false;
            } else {
              const created = yield* tryAsync(
                'create tenant admin in auth provider',
                () =>
                  betterAuth.api.createUser({
                    body: {
                      email: normalizedEmail,
                      name: adminName,
                      password: input.admin.password,
                      data: { emailVerified: true },
                    } satisfies BetterAuthCreateUserBody,
                  }) as Promise<BetterAuthCreateUserResponse>,
              );
              adminUserId = created.user.id;
              adminCreatedHere = true;
            }

            const created = yield* repository
              .createTenantWithAdmin({
                name: input.name.trim(),
                slug,
                hostname,
                adminUserId,
              })
              .pipe(
                Effect.catchAll((error) =>
                  Effect.fail(mapCreateTenantError(error, slug, hostname)),
                ),
                Effect.tapError(() =>
                  adminCreatedHere
                    ? usersRepository
                        .deleteBetterAuthUser(adminUserId)
                        .pipe(Effect.ignore)
                    : Effect.void,
                ),
              );

            const admin = {
              id: adminUserId,
              email: existing?.email ?? normalizedEmail,
              name: existing?.name ?? adminName,
            };
            const baseResponse = {
              tenant: created.tenant,
              admin,
            } satisfies SuperAdminCreateTenantResponse;

            const productImportResult = validatedProductImport
              ? yield* importProductsForTenant(
                  baseResponse,
                  validatedProductImport,
                  actor,
                ).pipe(
                  Effect.tapError(() =>
                    repository.deleteTenant(created.tenant.id).pipe(
                      Effect.tapError((cause) =>
                        Effect.logError({
                          messageKey: 'superadmin.repositoryFailed',
                          action: 'rollback tenant import',
                          cause,
                        } satisfies LogPayload),
                      ),
                      Effect.ignore,
                    ),
                  ),
                  Effect.tapError(() =>
                    adminCreatedHere
                      ? usersRepository
                          .deleteBetterAuthUser(adminUserId)
                          .pipe(Effect.ignore)
                      : Effect.void,
                  ),
                )
              : undefined;

            if (adminCreatedHere) {
              yield* Effect.forkDaemon(
                requestTenantAdminWelcomeEmail(
                  normalizedEmail,
                  created.tenant.hostname,
                ),
              );
            }

            yield* Effect.forkDaemon(
              repository
                .recordPlatformAuditEvent({
                  actorUserId: actor.userId,
                  action: 'tenant.create',
                  entityType: 'tenant',
                  entityId: created.tenant.id,
                  metadata: {
                    name: created.tenant.name,
                    slug: created.tenant.slug,
                    hostname: created.tenant.hostname,
                    adminUserId,
                    ...(productImportResult
                      ? {
                          productImport: {
                            filename: validatedProductImport?.filename,
                            categoriesCreated:
                              productImportResult.categoriesCreated,
                            locationsCreated:
                              productImportResult.locationsCreated,
                            productsCreated:
                              productImportResult.productsCreated,
                            inventoryRecordsCreated:
                              productImportResult.inventoryRecordsCreated,
                            rowsSkipped: productImportResult.rowsSkipped,
                          },
                        }
                      : {}),
                  },
                  ipAddress: actor.ipAddress ?? null,
                  userAgent: actor.userAgent ?? null,
                })
                .pipe(Effect.ignore),
            );

            return {
              ...baseResponse,
              ...(productImportResult
                ? { productImport: productImportResult }
                : {}),
            } satisfies SuperAdminCreateTenantResponse;
          }),
        (input) => ({ attributes: { entityId: input.slug } }),
      );

      const getTenantFeatures = trace.traced(
        'getTenantFeatures',
        (tenantId: string) => featuresService.getFeaturesForTenant(tenantId),
        (tenantId) => ({ attributes: { tenantId } }),
      );

      const deleteTenant = trace.traced(
        'deleteTenant',
        (
          tenantId: string,
          actor: {
            readonly userId: string;
            readonly ipAddress?: string | null;
            readonly userAgent?: string | null;
          },
        ) =>
          Effect.gen(function* () {
            const deleted = yield* repository.deleteTenant(tenantId);
            if (!deleted) {
              return yield* Effect.fail(
                new TenantNotFound({
                  tenantId,
                  messageKey: 'superadmin.tenantNotFound',
                }),
              );
            }

            yield* featuresService.invalidateTenant(tenantId);
            yield* Effect.forkDaemon(
              repository
                .recordPlatformAuditEvent({
                  actorUserId: actor.userId,
                  action: 'tenant.delete',
                  entityType: 'tenant',
                  entityId: deleted.id,
                  metadata: {
                    name: deleted.name,
                    slug: deleted.slug,
                    primaryHostname: deleted.primaryHostname,
                  },
                  ipAddress: actor.ipAddress ?? null,
                  userAgent: actor.userAgent ?? null,
                })
                .pipe(Effect.ignore),
            );
          }),
        (tenantId) => ({ attributes: { tenantId } }),
      );

      const updateTenantPlan = trace.traced(
        'updateTenantPlan',
        (tenantId: string, dto: UpdateTenantPlan, actorUserId: string) =>
          featuresService.setTenantPlan(tenantId, dto, actorUserId),
        (tenantId) => ({ attributes: { tenantId } }),
      );

      const updateTenantFeatureOverride = trace.traced(
        'updateTenantFeatureOverride',
        (
          tenantId: string,
          featureKey: FeatureKey,
          dto: UpdateTenantFeatureOverride,
          actorUserId: string,
        ) =>
          featuresService.setFeatureOverride(
            tenantId,
            featureKey,
            dto,
            actorUserId,
          ),
        (tenantId, featureKey) => ({
          attributes: { tenantId, entityId: featureKey },
        }),
      );

      const clearTenantFeatureOverride = trace.traced(
        'clearTenantFeatureOverride',
        (tenantId: string, featureKey: FeatureKey) =>
          featuresService.clearFeatureOverride(tenantId, featureKey),
        (tenantId, featureKey) => ({
          attributes: { tenantId, entityId: featureKey },
        }),
      );

      return {
        me,
        listTenants,
        createTenant,
        getTenantFeatures,
        deleteTenant,
        updateTenantPlan,
        updateTenantFeatureOverride,
        clearTenantFeatureOverride,
      };
    }),
    dependencies: [
      SuperAdminRepository.Default,
      UsersRepository.Default,
      FeaturesService.Default,
      ProductImportService.Default,
    ],
  },
) {}
