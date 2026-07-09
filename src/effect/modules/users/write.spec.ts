import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import type {
  BanUserDto,
  CreateUserDto,
  UserResponseDto,
} from '@stocket/types/users';
import { CurrentRequestContext } from '../../platform/http/request-context';
import type { BetterAuthCreateUserBody, BetterAuthUser } from './types';
import { UsersInfrastructureError } from './users.errors';
import { makeUserWriteWorkflows, type UserWriteRepository } from './write';

const tenantId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-03-01T00:00:00.000Z');
const requestContext = {
  requestId: '00000000-0000-4000-8000-000000000099',
  path: '/api/v1/users',
  method: 'POST' as const,
  ip: null,
  locale: 'en' as const,
  tenantId,
};

const authUser: BetterAuthUser = {
  id: 'user-1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  image: null,
  banned: false,
  banReason: null,
  banExpires: null,
  createdAt: now,
};

const createDto: CreateUserDto = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  password: 'password123',
  roles: ['role-1'],
};

type RoleAssignment = Effect.Effect.Success<
  ReturnType<UserWriteRepository['findUserRoles']>
>[number];

const roleAssignment = (name: string): RoleAssignment => ({
  id: 'assignment-1',
  user_id: 'user-1',
  role_id: 'role-1',
  role: {
    id: 'role-1',
    tenant_id: tenantId,
    name,
    description: null,
    is_system: false,
    created_at: now,
    updated_at: now,
  },
});

const userResponse = (
  overrides: Partial<UserResponseDto> = {},
): UserResponseDto => ({
  id: 'user-1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  image: null,
  roles: ['Admin'],
  banned: false,
  banReason: null,
  banExpires: null,
  createdAt: now,
  ...overrides,
});

const infrastructureError = (action: string, cause: unknown) =>
  new UsersInfrastructureError({
    action,
    cause,
    messageKey: 'users.repositoryFailed',
  });

const makeRepository = (
  overrides: Partial<UserWriteRepository> = {},
): UserWriteRepository => ({
  validateRoleIds: () => Effect.void,
  createTenantMembership: () => Effect.void,
  replaceUserRoles: () => Effect.void,
  deleteUserRoles: () => Effect.void,
  deleteTenantMembership: () => Effect.void,
  deleteBetterAuthUser: () => Effect.void,
  findUserRoles: () => Effect.succeed([roleAssignment('Admin')]),
  banBetterAuthUser: () => Effect.void,
  unbanBetterAuthUser: () => Effect.void,
  deleteBetterAuthSessions: () => Effect.void,
  hasTenantMemberships: () => Effect.succeed(false),
  ...overrides,
});

const withTenantContext = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(CurrentRequestContext, requestContext));

describe('user write workflows', () => {
  it.effect(
    'creates an auth user, tenant membership, roles, and response DTO',
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        let createdBody: BetterAuthCreateUserBody | undefined;
        let validatedRoles:
          | { readonly roleIds: string[]; readonly tenantId: string }
          | undefined;
        let replacedRoles:
          | {
              readonly userId: string;
              readonly roleIds: string[];
              readonly tenantId: string;
            }
          | undefined;

        const repository = makeRepository({
          validateRoleIds: (roleIds, checkedTenantId) =>
            Effect.sync(() => {
              validatedRoles = { roleIds, tenantId: checkedTenantId };
              calls.push('validate');
            }),
          createTenantMembership: (userId, checkedTenantId) =>
            Effect.sync(() => {
              expect(userId).toBe('user-1');
              expect(checkedTenantId).toBe(tenantId);
              calls.push('membership');
            }),
          replaceUserRoles: (userId, roleIds, checkedTenantId) =>
            Effect.sync(() => {
              replacedRoles = { userId, roleIds, tenantId: checkedTenantId };
              calls.push('roles');
            }),
          findUserRoles: () =>
            Effect.sync(() => {
              calls.push('findRoles');
              return [roleAssignment('Admin')];
            }),
        });
        const workflows = makeUserWriteWorkflows({
          repository,
          createAuthUser: (body) => {
            createdBody = body;
            calls.push('auth');
            return Promise.resolve({ user: authUser });
          },
          requestWelcomeEmail: () => Effect.void,
          requireTenantMember: () => Effect.succeed(tenantId),
          getBetterAuthUser: () => Effect.succeed(authUser),
          getUser: () => Effect.succeed(userResponse()),
          clearCacheForUser: () =>
            Effect.sync(() => {
              calls.push('clearCache');
            }),
        });

        const result = yield* withTenantContext(
          workflows.createUser(createDto),
        );

        expect(result).toEqual(userResponse());
        expect(createdBody).toEqual({
          email: createDto.email,
          name: createDto.name,
          password: createDto.password,
          data: { emailVerified: true },
        });
        expect(validatedRoles).toEqual({
          roleIds: ['role-1'],
          tenantId,
        });
        expect(replacedRoles).toEqual({
          userId: 'user-1',
          roleIds: ['role-1'],
          tenantId,
        });
        expect(calls).toEqual([
          'validate',
          'auth',
          'membership',
          'roles',
          'clearCache',
          'findRoles',
        ]);
      }),
  );

  it.effect(
    'cleans up auth and local rows when local setup fails after auth create',
    () =>
      Effect.gen(function* () {
        const cleanupCalls: string[] = [];
        const setupError = infrastructureError(
          'create tenant membership',
          new Error('membership insert failed'),
        );
        const repository = makeRepository({
          createTenantMembership: () => Effect.fail(setupError),
          deleteUserRoles: (userId, checkedTenantId) =>
            Effect.sync(() => {
              cleanupCalls.push(`roles:${userId}:${checkedTenantId}`);
            }),
          deleteTenantMembership: (userId, checkedTenantId) =>
            Effect.sync(() => {
              cleanupCalls.push(`membership:${userId}:${checkedTenantId}`);
            }),
          deleteBetterAuthUser: (userId) =>
            Effect.sync(() => {
              cleanupCalls.push(`auth:${userId}`);
            }),
        });
        const workflows = makeUserWriteWorkflows({
          repository,
          createAuthUser: () => Promise.resolve({ user: authUser }),
          requestWelcomeEmail: () => Effect.void,
          requireTenantMember: () => Effect.succeed(tenantId),
          getBetterAuthUser: () => Effect.succeed(authUser),
          getUser: () => Effect.succeed(userResponse()),
          clearCacheForUser: () => Effect.void,
        });

        const error = yield* Effect.flip(
          withTenantContext(workflows.createUser(createDto)),
        );

        expect(error).toBe(setupError);
        expect(cleanupCalls).toEqual([
          `roles:user-1:${tenantId}`,
          `membership:user-1:${tenantId}`,
          'auth:user-1',
        ]);
      }),
  );

  it.effect('updates tenant roles and returns the refreshed user', () =>
    Effect.gen(function* () {
      let membershipUserId: string | undefined;
      let loadedUserId: string | undefined;
      let replaced:
        | {
            readonly userId: string;
            readonly roleIds: string[];
            readonly tenantId: string;
          }
        | undefined;
      let cacheUserId: string | undefined;
      const refreshedUser = userResponse({ roles: ['Picker'] });
      const workflows = makeUserWriteWorkflows({
        repository: makeRepository({
          replaceUserRoles: (userId, roleIds, checkedTenantId) =>
            Effect.sync(() => {
              replaced = { userId, roleIds, tenantId: checkedTenantId };
            }),
        }),
        createAuthUser: () => Promise.resolve({ user: authUser }),
        requestWelcomeEmail: () => Effect.void,
        requireTenantMember: (userId) =>
          Effect.sync(() => {
            membershipUserId = userId;
            return tenantId;
          }),
        getBetterAuthUser: (userId) =>
          Effect.sync(() => {
            loadedUserId = userId;
            return authUser;
          }),
        getUser: () => Effect.succeed(refreshedUser),
        clearCacheForUser: (userId) =>
          Effect.sync(() => {
            cacheUserId = userId;
          }),
      });

      const result = yield* workflows.updateRoles('user-1', ['role-2']);

      expect(result).toEqual(refreshedUser);
      expect(membershipUserId).toBe('user-1');
      expect(loadedUserId).toBe('user-1');
      expect(replaced).toEqual({
        userId: 'user-1',
        roleIds: ['role-2'],
        tenantId,
      });
      expect(cacheUserId).toBe('user-1');
    }),
  );

  it.effect(
    'bans and unbans users through the local Better Auth repository',
    () =>
      Effect.gen(function* () {
        const banDto: BanUserDto = {
          reason: 'Policy violation',
          expiresAt: '2026-04-01T00:00:00.000Z',
        };
        let banCall:
          | {
              readonly userId: string;
              readonly reason?: string;
              readonly expiresAt?: string | null;
            }
          | undefined;
        let unbanUserId: string | undefined;
        const workflows = makeUserWriteWorkflows({
          repository: makeRepository({
            banBetterAuthUser: (userId, options) =>
              Effect.sync(() => {
                banCall = { userId, ...options };
              }),
            unbanBetterAuthUser: (userId) =>
              Effect.sync(() => {
                unbanUserId = userId;
              }),
          }),
          createAuthUser: () => Promise.resolve({ user: authUser }),
          requestWelcomeEmail: () => Effect.void,
          requireTenantMember: () => Effect.succeed(tenantId),
          getBetterAuthUser: () => Effect.succeed(authUser),
          getUser: (userId) => Effect.succeed(userResponse({ id: userId })),
          clearCacheForUser: () => Effect.void,
        });

        const banned = yield* workflows.banUser('user-1', banDto);
        const unbanned = yield* workflows.unbanUser('user-1');

        expect(banned.id).toBe('user-1');
        expect(unbanned.id).toBe('user-1');
        expect(banCall).toEqual({
          userId: 'user-1',
          reason: 'Policy violation',
          expiresAt: '2026-04-01T00:00:00.000Z',
        });
        expect(unbanUserId).toBe('user-1');
      }),
  );

  it.effect(
    'deletes the auth user only after the final tenant membership is removed',
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const makeWorkflows = (hasRemainingTenantMemberships: boolean) =>
          makeUserWriteWorkflows({
            repository: makeRepository({
              deleteUserRoles: (userId, checkedTenantId) =>
                Effect.sync(() => {
                  calls.push(`roles:${userId}:${checkedTenantId}`);
                }),
              deleteTenantMembership: (userId, checkedTenantId) =>
                Effect.sync(() => {
                  calls.push(`membership:${userId}:${checkedTenantId}`);
                }),
              hasTenantMemberships: (userId) =>
                Effect.sync(() => {
                  calls.push(`remaining:${userId}`);
                  return hasRemainingTenantMemberships;
                }),
              deleteBetterAuthUser: (userId) =>
                Effect.sync(() => {
                  calls.push(`auth:${userId}`);
                }),
            }),
            createAuthUser: () => Promise.resolve({ user: authUser }),
            requestWelcomeEmail: () => Effect.void,
            requireTenantMember: () => Effect.succeed(tenantId),
            getBetterAuthUser: () => Effect.succeed(authUser),
            getUser: () => Effect.succeed(userResponse()),
            clearCacheForUser: () => Effect.void,
          });

        yield* makeWorkflows(false).deleteUser('user-1');
        yield* makeWorkflows(true).deleteUser('user-2');

        expect(calls).toEqual([
          `roles:user-1:${tenantId}`,
          `membership:user-1:${tenantId}`,
          'remaining:user-1',
          'auth:user-1',
          `roles:user-2:${tenantId}`,
          `membership:user-2:${tenantId}`,
          'remaining:user-2',
        ]);
      }),
  );

  it.effect(
    'revokes Better Auth sessions after tenant membership and user checks',
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const workflows = makeUserWriteWorkflows({
          repository: makeRepository({
            deleteBetterAuthSessions: (userId) =>
              Effect.sync(() => {
                calls.push(`sessions:${userId}`);
              }),
          }),
          createAuthUser: () => Promise.resolve({ user: authUser }),
          requestWelcomeEmail: () => Effect.void,
          requireTenantMember: (userId) =>
            Effect.sync(() => {
              calls.push(`member:${userId}`);
              return tenantId;
            }),
          getBetterAuthUser: (userId) =>
            Effect.sync(() => {
              calls.push(`auth:${userId}`);
              return authUser;
            }),
          getUser: () => Effect.succeed(userResponse()),
          clearCacheForUser: () => Effect.void,
        });

        yield* workflows.revokeSessions('user-1');

        expect(calls).toEqual([
          'member:user-1',
          'auth:user-1',
          'sessions:user-1',
        ]);
      }),
  );
});
