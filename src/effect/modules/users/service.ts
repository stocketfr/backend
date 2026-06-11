import { Effect } from 'effect';
import type {
  CreateUserDto,
  UserQueryDto,
  UserResponseDto,
  BanUserDto,
} from '@stocket/types/users';
import { makeTryAsync } from '../../platform/try-async';
import { BetterAuth, BetterAuthHeaders } from '../../platform/better-auth';
import { type LogPayload } from '../../platform/messages';
import { makeServiceTracer } from '../../platform/service-tracer';
import {
  requireRequestTenantId,
  type TenantNotResolved,
} from '../../platform/tenant-context';
import { RolesService } from '../roles/service';
import { UserNotFound, UsersInfrastructureError } from './users.errors';
import { UsersRepository } from './repository';
import { welcomeRedirectUrl } from './users.utils';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new UsersInfrastructureError({
      action,
      cause,
      messageKey: 'users.infrastructureFailed',
    }),
);

interface BetterAuthUser {
  readonly id: string;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly image?: string | null;
  readonly banned?: boolean | null;
  readonly banReason?: string | null;
  readonly banExpires?: string | Date | null;
  readonly createdAt: string | Date;
}

interface BetterAuthCreateUserBody {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  // Admin-created users skip self-serve verification: clicking the emailed
  // set-password link proves mailbox ownership, and without this flag
  // `requireEmailVerification` would lock them out of sign-in.
  readonly data?: { readonly emailVerified: boolean };
}

interface BetterAuthCreateUserResponse {
  readonly user: BetterAuthUser;
}

const toUserResponse = (
  user: BetterAuthUser,
  roles: string[],
): UserResponseDto => ({
  id: user.id,
  name: user.name ?? '',
  email: user.email ?? '',
  image: user.image ?? null,
  roles,
  banned: user.banned ?? false,
  banReason: user.banReason ?? null,
  banExpires: user.banExpires ?? null,
  createdAt: user.createdAt,
});

export class UsersService extends Effect.Service<UsersService>()(
  '@stocket/effect/users/UsersService',
  {
    effect: Effect.gen(function* () {
      const betterAuth = yield* BetterAuth;
      const usersRepository = yield* UsersRepository;
      const rolesService = yield* RolesService;
      const trace = makeServiceTracer({
        serviceName: 'UsersService',
        module: 'users',
        layer: 'service',
        entityType: 'user',
      });
      const getBetterAuthUserOrFail = (
        id: string,
      ): Effect.Effect<
        BetterAuthUser,
        UserNotFound | UsersInfrastructureError
      > =>
        Effect.gen(function* () {
          const user = yield* usersRepository.findBetterAuthUser(id);
          return user
            ? yield* Effect.succeed(user)
            : yield* Effect.fail(
                new UserNotFound({
                  id,
                  messageKey: 'users.notFound',
                }),
              );
        });

      const requireTenantMemberOrFail = (userId: string) =>
        Effect.gen(function* () {
          const tenantId = yield* requireRequestTenantId;
          const hasTenantMembership =
            yield* usersRepository.hasTenantMembership(userId, tenantId);

          yield* Effect.filterOrFail(
            Effect.succeed(hasTenantMembership),
            Boolean,
            () =>
              new UserNotFound({
                id: userId,
                messageKey: 'users.notFound',
              }),
          );

          return tenantId;
        });

      const getUser = trace.traced(
        'getUser',
        (
          id: string,
        ): Effect.Effect<
          UserResponseDto,
          UserNotFound | UsersInfrastructureError | TenantNotResolved
        > =>
          Effect.gen(function* () {
            const tenantId = yield* requireTenantMemberOrFail(id);
            const user = yield* getBetterAuthUserOrFail(id);
            const roleEntities = yield* usersRepository.findUserRoles(
              id,
              tenantId,
            );

            return toUserResponse(
              user,
              roleEntities.map((roleEntity) => roleEntity.role.name),
            );
          }),
        (id) => ({ attributes: { userId: id } }),
      );

      const listUsers = trace.traced('listUsers', (query: UserQueryDto) =>
        Effect.gen(function* () {
          const tenantId = yield* requireRequestTenantId;
          const page = query.page ?? 1;
          const limit = query.limit ?? 20;
          const offset = (page - 1) * limit;

          const { users, total } = yield* usersRepository.listTenantUsers({
            tenantId,
            offset,
            limit,
            search: query.search,
            role: query.role,
          });
          const assignments = yield* usersRepository.findRoleAssignments(
            users.map((user) => user.id),
            tenantId,
          );

          const rolesByUserId = new Map<string, string[]>();
          for (const assignment of assignments) {
            const roleNames = rolesByUserId.get(assignment.user_id) ?? [];
            roleNames.push(assignment.role.name);
            rolesByUserId.set(assignment.user_id, roleNames);
          }

          return {
            data: users.map((user) =>
              toUserResponse(user, rolesByUserId.get(user.id) ?? []),
            ),
            total,
            page,
            limit,
            total_pages: Math.ceil(total / limit),
          };
        }),
      );

      // Welcome emails reuse the password-reset machinery: the `flow=welcome`
      // marker in `redirectTo` is what flips the template. Failures only log —
      // user creation must never roll back because an email could not be sent.
      const requestWelcomeEmail = (email: string) =>
        Effect.gen(function* () {
          const headers = yield* BetterAuthHeaders;
          const redirectTo = welcomeRedirectUrl(headers.get('origin'));
          yield* Effect.tryPromise(() =>
            betterAuth.api.requestPasswordReset({
              body: { email, redirectTo },
              headers,
              // better-auth only forwards ctx.request to the sendResetPassword
              // hook; without it the email loses the Accept-Language locale.
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

      const createUser = trace.traced('createUser', (dto: CreateUserDto) =>
          Effect.gen(function* () {
            const tenantId = yield* requireRequestTenantId;

            yield* usersRepository.validateRoleIds(dto.roles, tenantId);
            const result = yield* tryAsync(
              'create user in auth provider',
              () =>
                betterAuth.api.createUser({
                  body: {
                    email: dto.email,
                    name: dto.name,
                    password: dto.password,
                    data: { emailVerified: true },
                  } satisfies BetterAuthCreateUserBody,
                }) as Promise<BetterAuthCreateUserResponse>,
            );
          const userId = result.user.id;

          yield* Effect.gen(function* () {
            yield* usersRepository.createTenantMembership(userId, tenantId);
            yield* usersRepository.replaceUserRoles(
              userId,
              dto.roles,
              tenantId,
            );
            yield* rolesService.clearCacheForUser(userId);
          }).pipe(
            Effect.tapError(() =>
              Effect.all(
                [
                  usersRepository.deleteUserRoles(userId, tenantId),
                  usersRepository.deleteTenantMembership(userId, tenantId),
                  usersRepository.deleteBetterAuthUser(userId),
                ],
                { discard: true },
              ).pipe(Effect.ignore),
            ),
          );

          yield* Effect.forkDaemon(requestWelcomeEmail(dto.email));

          const roleEntities = yield* usersRepository.findUserRoles(
            userId,
            tenantId,
          );

          return toUserResponse(
            result.user,
            roleEntities.map((roleEntity) => roleEntity.role.name),
          );
        }),
      );

      const updateRoles = trace.traced(
        'updateRoles',
        (userId: string, roleIds: string[]) =>
          Effect.gen(function* () {
            const tenantId = yield* requireTenantMemberOrFail(userId);
            yield* getBetterAuthUserOrFail(userId);
            yield* usersRepository.replaceUserRoles(userId, roleIds, tenantId);

            yield* rolesService.clearCacheForUser(userId);

            return yield* getUser(userId);
          }),
        (userId) => ({ attributes: { userId } }),
      );

      const banUser = trace.traced(
        'banUser',
        (userId: string, dto: BanUserDto) =>
          Effect.gen(function* () {
            yield* requireTenantMemberOrFail(userId);
            yield* getBetterAuthUserOrFail(userId);
            yield* usersRepository.banBetterAuthUser(userId, {
              reason: dto.reason,
              expiresAt: dto.expiresAt,
            });

            return yield* getUser(userId);
          }),
        (userId) => ({ attributes: { userId } }),
      );

      const unbanUser = trace.traced(
        'unbanUser',
        (userId: string) =>
          Effect.gen(function* () {
            yield* requireTenantMemberOrFail(userId);
            yield* getBetterAuthUserOrFail(userId);
            yield* usersRepository.unbanBetterAuthUser(userId);

            return yield* getUser(userId);
          }),
        (userId) => ({ attributes: { userId } }),
      );

      const deleteUser = trace.traced(
        'deleteUser',
        (userId: string) =>
          Effect.gen(function* () {
            const tenantId = yield* requireTenantMemberOrFail(userId);
            yield* getBetterAuthUserOrFail(userId);
            yield* usersRepository.deleteUserRoles(userId, tenantId);
            yield* usersRepository.deleteTenantMembership(userId, tenantId);
            const hasRemainingTenantMemberships =
              yield* usersRepository.hasTenantMemberships(userId);

            if (!hasRemainingTenantMemberships) {
              yield* usersRepository.deleteBetterAuthUser(userId);
            }
          }),
        (userId) => ({ attributes: { userId } }),
      );

      const revokeSessions = trace.traced(
        'revokeSessions',
        (userId: string) =>
          Effect.gen(function* () {
            yield* requireTenantMemberOrFail(userId);
            yield* getBetterAuthUserOrFail(userId);
            yield* usersRepository.deleteBetterAuthSessions(userId);
          }),
        (userId) => ({ attributes: { userId } }),
      );

      return {
        listUsers,
        getUser,
        createUser,
        updateRoles,
        banUser,
        unbanUser,
        deleteUser,
        revokeSessions,
      };
    }),
    dependencies: [UsersRepository.Default, RolesService.Default],
  },
) {}
