import { Effect } from 'effect';
import type {
  CreateUserDto,
  UserQueryDto,
  UserResponseDto,
} from '@stocket/types/users';
import { BetterAuth } from '../../platform/auth/better-auth';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import {
  type TenantNotResolved,
  requireRequestTenantId,
} from '../../platform/tenancy/tenant-context';
import { RolesService } from '../roles/service';
import type { UserNotFound, UsersInfrastructureError } from './users.errors';
import { UsersRepository } from './repository';
import { toUserResponse } from './mappers';
import { resolveUserListWindow, toUserListResponse } from './list';
import { getBetterAuthUserOrFail, requireTenantMemberOrFail } from './access';
import { requestWelcomeEmail } from './welcome-email';
import { makeUserWriteWorkflows } from './write';
import type { BetterAuthCreateUserResponse } from './types';

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
      const requireTenantMember = (userId: string) =>
        requireTenantMemberOrFail(usersRepository, userId);
      const getBetterAuthUser = (userId: string) =>
        getBetterAuthUserOrFail(usersRepository, userId);

      const getUser = trace.traced(
        'getUser',
        (
          id: string,
        ): Effect.Effect<
          UserResponseDto,
          UserNotFound | UsersInfrastructureError | TenantNotResolved
        > =>
          Effect.gen(function* () {
            const tenantId = yield* requireTenantMember(id);
            const user = yield* getBetterAuthUser(id);
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
          const { page, limit, offset } = resolveUserListWindow(query);

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

          return toUserListResponse({
            users,
            assignments,
            total,
            page,
            limit,
          });
        }),
      );

      const userWriteWorkflows = makeUserWriteWorkflows({
        repository: usersRepository,
        createAuthUser: (body) =>
          betterAuth.api.createUser({
            body,
          }) as Promise<BetterAuthCreateUserResponse>,
        requestWelcomeEmail: (email) =>
          requestWelcomeEmail({
            email,
            requestPasswordReset: (request) =>
              betterAuth.api.requestPasswordReset(request),
          }),
        requireTenantMember,
        getBetterAuthUser,
        getUser,
        clearCacheForUser: rolesService.clearCacheForUser,
      });

      const createUser = trace.traced('createUser', (dto: CreateUserDto) =>
        userWriteWorkflows.createUser(dto),
      );

      const updateRoles = trace.traced(
        'updateRoles',
        userWriteWorkflows.updateRoles,
        (userId) => ({ attributes: { userId } }),
      );

      const banUser = trace.traced(
        'banUser',
        userWriteWorkflows.banUser,
        (userId) => ({ attributes: { userId } }),
      );

      const unbanUser = trace.traced(
        'unbanUser',
        userWriteWorkflows.unbanUser,
        (userId) => ({ attributes: { userId } }),
      );

      const deleteUser = trace.traced(
        'deleteUser',
        userWriteWorkflows.deleteUser,
        (userId) => ({ attributes: { userId } }),
      );

      const revokeSessions = trace.traced(
        'revokeSessions',
        userWriteWorkflows.revokeSessions,
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
