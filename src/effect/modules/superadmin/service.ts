import { Effect } from 'effect';
import type {
  CreateSuperAdminTenantInput,
  SuperAdminCreateTenantResponse,
  SuperAdminMeResponse,
  SuperAdminTenantListResponse,
} from '@stocket/types/superadmin';
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
import {
  tenantWelcomeOrigin,
  welcomeRedirectUrl,
} from '../users/users.utils';
import {
  InvalidTenantSlug,
  ReservedTenantSlug,
  SuperAdminRepositoryError,
  TenantHostnameAlreadyExists,
  TenantSlugAlreadyExists,
} from './superadmin.errors';
import { SuperAdminRepository } from './repository';

interface BetterAuthCreateUserResponse {
  readonly user: { readonly id: string };
}

interface BetterAuthCreateUserBody {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly data?: { readonly emailVerified: boolean };
}

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  value !== null && typeof value === 'object';

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

      const createTenant = trace.traced(
        'createTenant',
        (
          input: CreateSuperAdminTenantInput,
          actor: {
            readonly userId: string;
            readonly ipAddress?: string | null;
            readonly userAgent?: string | null;
          },
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
            } satisfies SuperAdminCreateTenantResponse;
          }),
        (input) => ({ attributes: { entityId: input.slug } }),
      );

      return {
        me,
        listTenants,
        createTenant,
      };
    }),
    dependencies: [SuperAdminRepository.Default, UsersRepository.Default],
  },
) {}
