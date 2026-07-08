import { HttpRouter } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { toPaginatedResponse } from '@stocket/types/common';
import type { CreateUserDto, UserQueryDto } from '@stocket/types/users';
import { Permission, Resource } from '@stocket/types/auth';
import {
  BanUserSchema,
  CreateUserSchema,
  UpdateUserRolesSchema,
  UserIdSchema,
  UserQuerySchema,
} from '@stocket/types/users';
import { BetterAuthHeaders } from '../../platform/auth/better-auth';
import { getRequestHeaders } from '../../platform/http/session';
import { respondEmpty } from '../../platform/http/errors';
import {
  jsonBody,
  pathParams,
  pathParamsAndJsonBody,
  queryParams,
  tenantRouteContext,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { UsersService } from './service';

const UserPathParamsSchema = Schema.Struct({
  id: UserIdSchema,
});

const provideBetterAuthHeaders = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const requestHeaders = yield* getRequestHeaders;
    return yield* effect.pipe(
      Effect.provideService(BetterAuthHeaders, requestHeaders),
    );
  });

export const usersRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    tenantRoute({
      permissions: [[Resource.USERS, Permission.READ]],
      decode: queryParams(UserQuerySchema),
      handler: ({ input: query }) => {
        const normalizedQuery = {
          page: query.page,
          limit: query.limit,
          ...(query.search ? { search: query.search } : {}),
          ...(query.role ? { role: query.role } : {}),
        } satisfies UserQueryDto;
        return Effect.flatMap(UsersService, (usersService) =>
          provideBetterAuthHeaders(
            usersService
              .listUsers(normalizedQuery)
              .pipe(Effect.map((result) => toPaginatedResponse(result, (user) => user))),
          ),
        );
      },
    }),
  ),
  HttpRouter.get(
    '/:id',
    tenantRoute({
      permissions: [[Resource.USERS, Permission.READ]],
      decode: pathParams(UserPathParamsSchema),
      handler: ({ input: { id } }) =>
        Effect.flatMap(UsersService, (usersService) =>
          provideBetterAuthHeaders(usersService.getUser(id)),
        ),
    }),
  ),
  HttpRouter.post(
    '/',
    tenantRoute({
      permissions: [[Resource.USERS, Permission.WRITE]],
      decode: jsonBody(CreateUserSchema),
      handler: ({ input: dto }) =>
        Effect.flatMap(UsersService, (usersService) => {
          const createDto: CreateUserDto = {
            name: dto.name,
            email: dto.email,
            password: dto.password,
            roles: [...dto.roles],
          };
          return provideBetterAuthHeaders(usersService.createUser(createDto));
        }),
      responseOptions: { status: 201 },
    }),
  ),
  HttpRouter.put(
    '/:id/roles',
    tenantRoute({
      permissions: [[Resource.USERS, Permission.WRITE]],
      decode: pathParamsAndJsonBody(
        UserPathParamsSchema,
        UpdateUserRolesSchema,
      ),
      handler: ({ input: { path, body: dto } }) =>
        Effect.flatMap(UsersService, (usersService) =>
          provideBetterAuthHeaders(
            usersService.updateRoles(path.id, [...dto.roles]),
          ),
        ),
    }),
  ),
  HttpRouter.patch(
    '/:id/ban',
    tenantRoute({
      permissions: [[Resource.USERS, Permission.WRITE]],
      decode: pathParamsAndJsonBody(UserPathParamsSchema, BanUserSchema),
      handler: ({ input: { path, body: dto } }) =>
        Effect.flatMap(UsersService, (usersService) =>
          provideBetterAuthHeaders(
            usersService.banUser(path.id, {
              reason: dto.reason,
              expiresAt: dto.expiresAt?.toISOString(),
            }),
          ),
        ),
    }),
  ),
  HttpRouter.patch(
    '/:id/unban',
    tenantRoute({
      permissions: [[Resource.USERS, Permission.WRITE]],
      decode: pathParams(UserPathParamsSchema),
      handler: ({ input: { id } }) =>
        Effect.flatMap(UsersService, (usersService) =>
          provideBetterAuthHeaders(usersService.unbanUser(id)),
        ),
    }),
  ),
  HttpRouter.del(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.USERS, Permission.WRITE]],
      decode: pathParams(UserPathParamsSchema),
    }).pipe(
      Effect.flatMap(({ input: { id } }) =>
        respondEmpty(
          Effect.flatMap(UsersService, (usersService) =>
            provideBetterAuthHeaders(usersService.deleteUser(id)),
          ),
          { status: 200 },
        ),
      ),
    ),
  ),
  HttpRouter.post(
    '/:id/revoke-sessions',
    tenantRouteContext({
      permissions: [[Resource.USERS, Permission.WRITE]],
      decode: pathParams(UserPathParamsSchema),
    }).pipe(
      Effect.flatMap(({ input: { id } }) =>
        respondEmpty(
          Effect.flatMap(UsersService, (usersService) =>
            provideBetterAuthHeaders(usersService.revokeSessions(id)),
          ),
          { status: 200 },
        ),
      ),
    ),
  ),
  HttpRouter.prefixAll('/users'),
);
