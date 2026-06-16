import { HttpRouter, HttpServerRequest } from '@effect/platform';
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
import { requirePermission } from '../../platform/auth/authorization';
import { respondEmpty, respondJson } from '../../platform/http/errors';
import { BetterAuthHeaders } from '../../platform/auth/better-auth';
import { getRequestHeaders } from '../../platform/http/session';
import { UsersService } from './service';

const UserPathParamsSchema = Schema.Struct({
  id: UserIdSchema,
});

export const usersRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.USERS, Permission.READ);
      const query =
        yield* HttpServerRequest.schemaSearchParams(UserQuerySchema);
      const normalizedQuery = {
        page: query.page,
        limit: query.limit,
        ...(query.search ? { search: query.search } : {}),
        ...(query.role ? { role: query.role } : {}),
      } satisfies UserQueryDto;
      const requestHeaders = yield* getRequestHeaders;
      const usersService = yield* UsersService;
      return yield* respondJson(
        Effect.map(
          usersService
            .listUsers(normalizedQuery)
            .pipe(Effect.provideService(BetterAuthHeaders, requestHeaders)),
          (result) => toPaginatedResponse(result, (user) => user),
        ),
      );
    }),
  ),
  HttpRouter.get(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.USERS, Permission.READ);
      const { id } = yield* HttpRouter.schemaPathParams(UserPathParamsSchema);
      const requestHeaders = yield* getRequestHeaders;
      const usersService = yield* UsersService;
      return yield* respondJson(
        usersService
          .getUser(id)
          .pipe(Effect.provideService(BetterAuthHeaders, requestHeaders)),
      );
    }),
  ),
  HttpRouter.post(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.USERS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(CreateUserSchema);
      const requestHeaders = yield* getRequestHeaders;
      const usersService = yield* UsersService;
      const createDto: CreateUserDto = {
        name: dto.name,
        email: dto.email,
        password: dto.password,
        roles: [...dto.roles],
      };
      return yield* respondJson(
        usersService
          .createUser(createDto)
          .pipe(Effect.provideService(BetterAuthHeaders, requestHeaders)),
        {
          status: 201,
        },
      );
    }),
  ),
  HttpRouter.put(
    '/:id/roles',
    Effect.gen(function* () {
      yield* requirePermission(Resource.USERS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(UserPathParamsSchema);
      const dto = yield* HttpServerRequest.schemaBodyJson(
        UpdateUserRolesSchema,
      );
      const requestHeaders = yield* getRequestHeaders;
      const usersService = yield* UsersService;
      return yield* respondJson(
        usersService
          .updateRoles(id, [...dto.roles])
          .pipe(Effect.provideService(BetterAuthHeaders, requestHeaders)),
      );
    }),
  ),
  HttpRouter.patch(
    '/:id/ban',
    Effect.gen(function* () {
      yield* requirePermission(Resource.USERS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(UserPathParamsSchema);
      const dto = yield* HttpServerRequest.schemaBodyJson(BanUserSchema);
      const requestHeaders = yield* getRequestHeaders;
      const usersService = yield* UsersService;
      return yield* respondJson(
        usersService
          .banUser(id, {
            reason: dto.reason,
            expiresAt: dto.expiresAt?.toISOString(),
          })
          .pipe(Effect.provideService(BetterAuthHeaders, requestHeaders)),
      );
    }),
  ),
  HttpRouter.patch(
    '/:id/unban',
    Effect.gen(function* () {
      yield* requirePermission(Resource.USERS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(UserPathParamsSchema);
      const requestHeaders = yield* getRequestHeaders;
      const usersService = yield* UsersService;
      return yield* respondJson(
        usersService
          .unbanUser(id)
          .pipe(Effect.provideService(BetterAuthHeaders, requestHeaders)),
      );
    }),
  ),
  HttpRouter.del(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.USERS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(UserPathParamsSchema);
      const requestHeaders = yield* getRequestHeaders;
      const usersService = yield* UsersService;
      return yield* respondEmpty(
        usersService
          .deleteUser(id)
          .pipe(Effect.provideService(BetterAuthHeaders, requestHeaders)),
        {
          status: 200,
        },
      );
    }),
  ),
  HttpRouter.post(
    '/:id/revoke-sessions',
    Effect.gen(function* () {
      yield* requirePermission(Resource.USERS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(UserPathParamsSchema);
      const requestHeaders = yield* getRequestHeaders;
      const usersService = yield* UsersService;
      return yield* respondEmpty(
        usersService
          .revokeSessions(id)
          .pipe(Effect.provideService(BetterAuthHeaders, requestHeaders)),
        {
          status: 200,
        },
      );
    }),
  ),
  HttpRouter.prefixAll('/users'),
);
