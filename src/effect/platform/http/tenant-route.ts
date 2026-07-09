import {
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from '@effect/platform';
import { Effect, type Schema } from 'effect';
import type { Permission, Resource } from '@stocket/types/auth';
import { requirePermission } from '../auth/authorization';
import { getOptionalSession, requireSession } from './session';
import { respondJson } from './errors';
import { searchParams } from './search-params';
import type { UserSession } from '../auth/user-session';

export type PermissionRequirement = readonly [Resource, Permission];

export interface TenantRouteContext<Input> {
  readonly input: Input;
  readonly session: UserSession | null;
  readonly userId: string | undefined;
}

export interface TenantRouteContextOptions<
  Input,
  DecodeError,
  DecodeContext,
  GuardError = never,
  GuardContext = never,
> {
  readonly permissions?: readonly PermissionRequirement[];
  readonly guard?: Effect.Effect<void, GuardError, GuardContext>;
  readonly decode: Effect.Effect<Input, DecodeError, DecodeContext>;
  readonly session?: 'none' | 'optional' | 'required';
}

export interface TenantRouteOptions<
  Input,
  DecodeError,
  DecodeContext,
  A,
  E,
  R,
  GuardError = never,
  GuardContext = never,
> extends TenantRouteContextOptions<
  Input,
  DecodeError,
  DecodeContext,
  GuardError,
  GuardContext
> {
  readonly handler: (
    context: TenantRouteContext<Input>,
  ) => Effect.Effect<A, E, R>;
  readonly responseOptions?: HttpServerResponse.Options.WithContentType;
}

export const emptyInput = Effect.succeed({});

export const queryParams = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  searchParams(schema);

type PathParamsEncoded = Readonly<Record<string, string | undefined>>;

const toPathParamsSchema = <A, I, R>(
  schema: Schema.Schema<A, I, R>,
): Schema.Schema<A, PathParamsEncoded, R> =>
  // `schemaPathParams` provides URL path segments as a string dictionary. Most
  // route-local structs do not encode that index signature, so the cast stays
  // at this adapter boundary.
  schema as unknown as Schema.Schema<A, PathParamsEncoded, R>;

export const pathParams = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  HttpRouter.schemaPathParams(toPathParamsSchema(schema));

export const jsonBody = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  HttpServerRequest.schemaBodyJson(schema);

export const pathParamsAndJsonBody = <Path, PathI, PathR, Body, BodyI, BodyR>(
  pathSchema: Schema.Schema<Path, PathI, PathR>,
  bodySchema: Schema.Schema<Body, BodyI, BodyR>,
) =>
  Effect.gen(function* () {
    const path = yield* pathParams(pathSchema);
    const body = yield* jsonBody(bodySchema);
    return { path, body };
  });

export const pathParamsAndQueryParams = <
  Path,
  PathI,
  PathR,
  Query,
  QueryI,
  QueryR,
>(
  pathSchema: Schema.Schema<Path, PathI, PathR>,
  querySchema: Schema.Schema<Query, QueryI, QueryR>,
) =>
  Effect.gen(function* () {
    const path = yield* pathParams(pathSchema);
    const query = yield* queryParams(querySchema);
    return { path, query };
  });

export const tenantRouteContext = <
  Input,
  DecodeError,
  DecodeContext,
  GuardError = never,
  GuardContext = never,
>(
  options: TenantRouteContextOptions<
    Input,
    DecodeError,
    DecodeContext,
    GuardError,
    GuardContext
  >,
) =>
  Effect.gen(function* () {
    for (const [resource, permission] of options.permissions ?? []) {
      yield* requirePermission(resource, permission);
    }

    if (options.guard) {
      yield* options.guard;
    }

    const input = yield* options.decode;
    const session =
      options.session === 'required'
        ? yield* requireSession
        : options.session === 'optional'
          ? yield* getOptionalSession
          : null;

    return {
      input,
      session,
      userId: session?.user.id,
    } satisfies TenantRouteContext<Input>;
  });

export const tenantRoute = <
  Input,
  DecodeError,
  DecodeContext,
  A,
  E,
  R,
  GuardError = never,
  GuardContext = never,
>(
  options: TenantRouteOptions<
    Input,
    DecodeError,
    DecodeContext,
    A,
    E,
    R,
    GuardError,
    GuardContext
  >,
) =>
  Effect.gen(function* () {
    const context = yield* tenantRouteContext(options);
    return yield* respondJson(
      options.handler(context),
      options.responseOptions,
    );
  });
