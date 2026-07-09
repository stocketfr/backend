import { Effect } from 'effect';
import type {
  BanUserDto,
  CreateUserDto,
  UserResponseDto,
} from '@stocket/types/users';
import { makeTryAsync } from '../../platform/effect/try-async';
import { requireRequestTenantId } from '../../platform/tenancy/tenant-context';
import type { UsersRepository } from './repository';
import { toUserResponse } from './mappers';
import type {
  BetterAuthCreateUserBody,
  BetterAuthCreateUserResponse,
  BetterAuthUser,
} from './types';
import { UsersInfrastructureError } from './users.errors';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new UsersInfrastructureError({
      action,
      cause,
      messageKey: 'users.infrastructureFailed',
    }),
);

type UserRoleAssignment = Effect.Effect.Success<
  ReturnType<UsersRepository['findUserRoles']>
>[number];

export interface UserWriteRepository {
  readonly validateRoleIds: (
    roleIds: string[],
    tenantId: string,
  ) => Effect.Effect<unknown, UsersInfrastructureError>;
  readonly createTenantMembership: (
    userId: string,
    tenantId: string,
  ) => Effect.Effect<unknown, UsersInfrastructureError>;
  readonly replaceUserRoles: (
    userId: string,
    roleIds: string[],
    tenantId: string,
  ) => Effect.Effect<unknown, UsersInfrastructureError>;
  readonly deleteUserRoles: (
    userId: string,
    tenantId: string,
  ) => Effect.Effect<unknown, UsersInfrastructureError>;
  readonly deleteTenantMembership: (
    userId: string,
    tenantId: string,
  ) => Effect.Effect<unknown, UsersInfrastructureError>;
  readonly deleteBetterAuthUser: (
    userId: string,
  ) => Effect.Effect<unknown, UsersInfrastructureError>;
  readonly findUserRoles: (
    userId: string,
    tenantId: string,
  ) => Effect.Effect<
    ReadonlyArray<UserRoleAssignment>,
    UsersInfrastructureError
  >;
  readonly banBetterAuthUser: (
    userId: string,
    options: { readonly reason?: string; readonly expiresAt?: string | null },
  ) => Effect.Effect<unknown, UsersInfrastructureError>;
  readonly unbanBetterAuthUser: (
    userId: string,
  ) => Effect.Effect<unknown, UsersInfrastructureError>;
  readonly deleteBetterAuthSessions: (
    userId: string,
  ) => Effect.Effect<unknown, UsersInfrastructureError>;
  readonly hasTenantMemberships: (
    userId: string,
  ) => Effect.Effect<boolean, UsersInfrastructureError>;
}

interface UserWriteWorkflowOptions<
  AccessError,
  AccessContext,
  ReadError,
  ReadContext,
  CacheError,
  CacheContext,
  WelcomeContext,
> {
  readonly repository: UserWriteRepository;
  readonly createAuthUser: (
    body: BetterAuthCreateUserBody,
  ) => Promise<BetterAuthCreateUserResponse>;
  readonly requestWelcomeEmail: (
    email: string,
  ) => Effect.Effect<void, never, WelcomeContext>;
  readonly requireTenantMember: (
    userId: string,
  ) => Effect.Effect<string, AccessError, AccessContext>;
  readonly getBetterAuthUser: (
    userId: string,
  ) => Effect.Effect<BetterAuthUser, AccessError, AccessContext>;
  readonly getUser: (
    userId: string,
  ) => Effect.Effect<UserResponseDto, ReadError, ReadContext>;
  readonly clearCacheForUser: (
    userId: string,
  ) => Effect.Effect<void, CacheError, CacheContext>;
}

export const makeUserWriteWorkflows = <
  AccessError,
  AccessContext,
  ReadError,
  ReadContext,
  CacheError,
  CacheContext,
  WelcomeContext,
>({
  repository,
  createAuthUser,
  requestWelcomeEmail,
  requireTenantMember,
  getBetterAuthUser,
  getUser,
  clearCacheForUser,
}: UserWriteWorkflowOptions<
  AccessError,
  AccessContext,
  ReadError,
  ReadContext,
  CacheError,
  CacheContext,
  WelcomeContext
>) => {
  const createUser = (dto: CreateUserDto) =>
    Effect.gen(function* () {
      const tenantId = yield* requireRequestTenantId;

      yield* repository.validateRoleIds(dto.roles, tenantId);
      const result = yield* tryAsync('create user in auth provider', () =>
        createAuthUser({
          email: dto.email,
          name: dto.name,
          password: dto.password,
          data: { emailVerified: true },
        }),
      );
      const userId = result.user.id;

      yield* Effect.gen(function* () {
        yield* repository.createTenantMembership(userId, tenantId);
        yield* repository.replaceUserRoles(userId, dto.roles, tenantId);
        yield* clearCacheForUser(userId);
      }).pipe(
        Effect.tapError(() =>
          Effect.all(
            [
              repository.deleteUserRoles(userId, tenantId),
              repository.deleteTenantMembership(userId, tenantId),
              repository.deleteBetterAuthUser(userId),
            ],
            { discard: true },
          ).pipe(Effect.ignore),
        ),
      );

      yield* Effect.forkDaemon(requestWelcomeEmail(dto.email));

      const roleEntities = yield* repository.findUserRoles(userId, tenantId);

      return toUserResponse(
        result.user,
        roleEntities.map((roleEntity) => roleEntity.role.name),
      );
    });

  const updateRoles = (userId: string, roleIds: string[]) =>
    Effect.gen(function* () {
      const tenantId = yield* requireTenantMember(userId);
      yield* getBetterAuthUser(userId);
      yield* repository.replaceUserRoles(userId, roleIds, tenantId);
      yield* clearCacheForUser(userId);

      return yield* getUser(userId);
    });

  const banUser = (userId: string, dto: BanUserDto) =>
    Effect.gen(function* () {
      yield* requireTenantMember(userId);
      yield* getBetterAuthUser(userId);
      yield* repository.banBetterAuthUser(userId, {
        reason: dto.reason,
        expiresAt: dto.expiresAt,
      });

      return yield* getUser(userId);
    });

  const unbanUser = (userId: string) =>
    Effect.gen(function* () {
      yield* requireTenantMember(userId);
      yield* getBetterAuthUser(userId);
      yield* repository.unbanBetterAuthUser(userId);

      return yield* getUser(userId);
    });

  const deleteUser = (userId: string) =>
    Effect.gen(function* () {
      const tenantId = yield* requireTenantMember(userId);
      yield* getBetterAuthUser(userId);
      yield* repository.deleteUserRoles(userId, tenantId);
      yield* repository.deleteTenantMembership(userId, tenantId);
      const hasRemainingTenantMemberships =
        yield* repository.hasTenantMemberships(userId);

      if (!hasRemainingTenantMemberships) {
        yield* repository.deleteBetterAuthUser(userId);
      }
    });

  const revokeSessions = (userId: string) =>
    Effect.gen(function* () {
      yield* requireTenantMember(userId);
      yield* getBetterAuthUser(userId);
      yield* repository.deleteBetterAuthSessions(userId);
    });

  return {
    createUser,
    updateRoles,
    banUser,
    unbanUser,
    deleteUser,
    revokeSessions,
  };
};
