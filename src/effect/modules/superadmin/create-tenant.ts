import { Effect } from 'effect';
import type { CreateSuperAdminTenantInput } from '@stocket/types/superadmin';
import {
  hostnameForTenantSlug,
  isReservedTenantSlug,
  isValidTenantSlug,
} from '../../platform/tenancy/host';
import {
  BetterAuthHeaders,
  type BetterAuthService,
} from '../../platform/auth/better-auth';
import { type LogPayload } from '../../platform/observability/messages';
import { makeTryAsync } from '../../platform/effect/try-async';
import { tenantWelcomeOrigin, welcomeRedirectUrl } from '../users/users.utils';
import type { SuperAdminRepository } from './repository';
import type { UsersRepository } from '../users/repository';
import type { ProductImportService } from '../products/import/service';
import { pgUniqueViolationConstraintName } from '../../platform/db/pg-errors';
import {
  InvalidTenantSlug,
  ReservedTenantSlug,
  SuperAdminRepositoryError,
  TenantHostnameAlreadyExists,
  TenantSlugAlreadyExists,
} from './superadmin.errors';
import type { CreateTenantActor, CreateTenantProductImport } from './types';
import {
  importProductsForTenant,
  validateProductImport,
} from './tenant-import';

interface BetterAuthCreateUserResponse {
  readonly user: { readonly id: string };
}

interface BetterAuthCreateUserBody {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly data?: { readonly emailVerified: boolean };
}

interface CreateTenantWorkflowDependencies {
  readonly repository: typeof SuperAdminRepository.Service;
  readonly usersRepository: typeof UsersRepository.Service;
  readonly betterAuth: BetterAuthService;
  readonly productImportService: typeof ProductImportService.Service;
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

const tryAsync = makeTryAsync(
  (action, cause) =>
    new SuperAdminRepositoryError({
      action,
      cause,
      messageKey: 'superadmin.repositoryFailed',
    }),
);

export const makeCreateTenantWorkflow = ({
  repository,
  usersRepository,
  betterAuth,
  productImportService,
}: CreateTenantWorkflowDependencies) => {
  const requestTenantAdminWelcomeEmail = (email: string, hostname: string) =>
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

  return (
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
        ? yield* validateProductImport(productImport, productImportService)
        : undefined;

      const normalizedEmail = input.admin.email.trim().toLowerCase();
      const adminName = input.admin.name.trim();

      const existing =
        yield* repository.findBetterAuthUserByLoweredEmail(normalizedEmail);

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
      };

      const productImportResult = validatedProductImport
        ? yield* importProductsForTenant(
            baseResponse,
            validatedProductImport,
            actor,
            productImportService,
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
                      categoriesCreated: productImportResult.categoriesCreated,
                      locationsCreated: productImportResult.locationsCreated,
                      productsCreated: productImportResult.productsCreated,
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
        ...(productImportResult ? { productImport: productImportResult } : {}),
      };
    });
};
