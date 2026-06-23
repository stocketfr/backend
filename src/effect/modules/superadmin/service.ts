import { Cause, Effect, Exit, Layer, Option } from 'effect';
import type {
  ProductImportErrorDto,
  ProductImportResultDto,
} from '@stocket/types/products';
import type {
  CreateSuperAdminTenantInput,
  SuperAdminCreateTenantResponse,
  SuperAdminMeResponse,
  SuperAdminTenantListResponse,
} from '@stocket/types/superadmin';
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
import { DrizzleDatabase, type DrizzleDb } from '../../platform/db/drizzle';
import { isAppError } from '../../platform/effect/domain-errors';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../../platform/http/request-context';
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
  SuperAdminTenantImportInvalid,
  TenantHostnameAlreadyExists,
  TenantSlugAlreadyExists,
} from './superadmin.errors';
import { ProductImportService } from '../products/import/service';
import {
  type CreatedTenantResult,
  type CreateTenantInput,
  SuperAdminRepository,
} from './repository';
import { FeaturesService } from '../features/service';

interface BetterAuthCreateUserResponse {
  readonly user: { readonly id: string };
}

interface BetterAuthCreateUserBody {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly data?: { readonly emailVerified: boolean };
}

interface TenantImportFile {
  readonly filename?: string;
  readonly content: string;
}

interface CreateTenantOptions {
  readonly importFile?: TenantImportFile;
}

interface CreatedTenantWithImportResult extends CreatedTenantResult {
  readonly productImport?: ProductImportResultDto;
}

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  value !== null && typeof value === 'object';

const importErrorDetails = (errors: readonly ProductImportErrorDto[]): string =>
  errors
    .slice(0, 5)
    .map((error) =>
      error.row > 0 ? `Row ${error.row}: ${error.error}` : error.error,
    )
    .join('; ');

const makeTenantImportInvalid = (
  file: TenantImportFile,
  errors: readonly ProductImportErrorDto[],
  cause?: unknown,
) => {
  const details =
    importErrorDetails(errors) ||
    (cause instanceof Error && cause.message
      ? cause.message
      : 'The import file is not valid.');

  return new SuperAdminTenantImportInvalid({
    filename: file.filename,
    details,
    cause,
    messageKey: 'superadmin.tenantImportInvalid',
    messageArgs: { details },
  });
};

class SuperAdminTransactionDefect extends Error {
  constructor(public readonly cause: Cause.Cause<unknown>) {
    super(Cause.pretty(cause));
    this.name = 'SuperAdminTransactionDefect';
  }
}

const runEffectAsPromise = async <A, E>(
  effect: Effect.Effect<A, E, never>,
): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;

  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;
  throw new SuperAdminTransactionDefect(exit.cause);
};

const makeTenantImportRequestContext = (
  current: Option.Option<RequestContext>,
  created: CreatedTenantResult,
  actor: { readonly ipAddress?: string | null },
): RequestContext => {
  const base = Option.isSome(current) ? current.value : null;
  return {
    requestId: base?.requestId ?? '00000000-0000-4000-8000-000000000301',
    path: base?.path ?? '/api/v1/superadmin/tenants',
    method: base?.method ?? ('POST' as RequestContext['method']),
    ip: base?.ip ?? actor.ipAddress ?? null,
    locale: base?.locale ?? 'en',
    tenantId: created.tenant.id,
    tenantName: created.tenant.name,
    tenantSlug: created.tenant.slug,
  };
};

const mapTransactionCause = (cause: unknown) =>
  isAppError(cause)
    ? cause
    : new SuperAdminRepositoryError({
        action: 'create tenant with import',
        cause,
        messageKey: 'superadmin.repositoryFailed',
      });

const uniqueConstraintName = (cause: unknown): string | null => {
  if (!isRecord(cause)) return null;

  if (cause.code === '23505' && typeof cause.constraint === 'string') {
    return cause.constraint;
  }

  return uniqueConstraintName(cause.cause);
};

const mapCreateTenantError = (
  error: SuperAdminRepositoryError,
  slug: string,
  hostname: string,
) => {
  const constraint = uniqueConstraintName(error);
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
      const db = yield* DrizzleDatabase;
      const productImportService = yield* ProductImportService;
      const featuresService = yield* FeaturesService;
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

      const validateTenantImportFile = (file: TenantImportFile) =>
        productImportService
          .validateCsvContent({ content: file.content, requireRows: true })
          .pipe(
            Effect.mapError((error) =>
              makeTenantImportInvalid(
                file,
                [{ row: 0, error: error.message }],
                error,
              ),
            ),
            Effect.flatMap((validated) =>
              validated.result.errors.length > 0
                ? Effect.fail(
                    makeTenantImportInvalid(file, validated.result.errors),
                  )
                : Effect.succeed(validated),
            ),
          );

      const createTenantWithImport = (
        input: CreateTenantInput,
        file: TenantImportFile,
        actor: { readonly ipAddress?: string | null },
      ) =>
        Effect.gen(function* () {
          const requestContext = yield* Effect.serviceOption(
            CurrentRequestContext,
          );

          return yield* Effect.tryPromise({
            try: () =>
              db.transaction(async (tx) => {
                const txDb = tx as unknown as DrizzleDb;
                const txDbLayer = Layer.succeed(DrizzleDatabase, txDb);
                const txRepositoryLayer = SuperAdminRepository.Default.pipe(
                  Layer.provide(txDbLayer),
                );

                const txEffect = Effect.gen(function* () {
                  const txRepository = yield* SuperAdminRepository;
                  const created =
                    yield* txRepository.createTenantWithAdminRecords(input);
                  const importRequestContext = makeTenantImportRequestContext(
                    requestContext,
                    created,
                    actor,
                  );
                  const txImportLayer = ProductImportService.Default.pipe(
                    Layer.provide(txDbLayer),
                  );
                  const productImport = yield* Effect.flatMap(
                    ProductImportService,
                    (service) =>
                      service.importFromCsvContent({
                        content: file.content,
                        importType: 'auto',
                        userId: input.adminUserId,
                      }),
                  ).pipe(
                    Effect.provide(txImportLayer),
                    Effect.provideService(
                      CurrentRequestContext,
                      importRequestContext,
                    ),
                    Effect.mapError((error) =>
                      makeTenantImportInvalid(
                        file,
                        [{ row: 0, error: error.message }],
                        error,
                      ),
                    ),
                  );

                  if (productImport.errors.length > 0) {
                    return yield* Effect.fail(
                      makeTenantImportInvalid(file, productImport.errors),
                    );
                  }

                  return {
                    ...created,
                    productImport,
                  } satisfies CreatedTenantWithImportResult;
                }).pipe(Effect.provide(txRepositoryLayer));

                return runEffectAsPromise(txEffect);
              }),
            catch: mapTransactionCause,
          });
        });

      const createTenant = trace.traced(
        'createTenant',
        (
          input: CreateSuperAdminTenantInput,
          actor: {
            readonly userId: string;
            readonly ipAddress?: string | null;
            readonly userAgent?: string | null;
          },
          options: CreateTenantOptions = {},
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

            if (options.importFile) {
              yield* validateTenantImportFile(options.importFile);
            }

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

            const tenantInput = {
              name: input.name.trim(),
              slug,
              hostname,
              adminUserId,
            } satisfies CreateTenantInput;

            const createTenantRecords = (
              options.importFile
                ? createTenantWithImport(tenantInput, options.importFile, actor)
                : repository
                    .createTenantWithAdmin(tenantInput)
                    .pipe(
                      Effect.map(
                        (created): CreatedTenantWithImportResult => created,
                      ),
                    )
            ) as Effect.Effect<CreatedTenantWithImportResult, unknown, never>;

            const created = yield* createTenantRecords.pipe(
              Effect.mapError((error) =>
                error instanceof SuperAdminRepositoryError
                  ? mapCreateTenantError(error, slug, hostname)
                  : error,
              ),
              Effect.tapError(() =>
                adminCreatedHere
                  ? usersRepository
                      .deleteBetterAuthUser(adminUserId)
                      .pipe(Effect.ignore)
                  : Effect.void,
              ),
            );

            const importSummary = created.productImport
              ? {
                  filename: options.importFile?.filename ?? null,
                  categoriesCreated: created.productImport.categoriesCreated,
                  locationsCreated: created.productImport.locationsCreated,
                  productsCreated: created.productImport.productsCreated,
                  productsUpdated: created.productImport.productsUpdated,
                  inventoryRecordsCreated:
                    created.productImport.inventoryRecordsCreated,
                  inventoryRecordsUpdated:
                    created.productImport.inventoryRecordsUpdated,
                  rowsSkipped: created.productImport.rowsSkipped,
                }
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
                    ...(importSummary ? { productImport: importSummary } : {}),
                  },
                  ipAddress: actor.ipAddress ?? null,
                  userAgent: actor.userAgent ?? null,
                })
                .pipe(Effect.ignore),
            );

            return {
              tenant: created.tenant,
              admin: {
                id: adminUserId,
                email: existing?.email ?? normalizedEmail,
                name: existing?.name ?? adminName,
              },
              ...(created.productImport
                ? { productImport: created.productImport }
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
        updateTenantPlan,
        updateTenantFeatureOverride,
        clearTenantFeatureOverride,
      };
    }),
    dependencies: [
      SuperAdminRepository.Default,
      UsersRepository.Default,
      ProductImportService.Default,
      FeaturesService.Default,
    ],
  },
) {}
