import { HttpServerRequest } from '@effect/platform';
import { Effect } from 'effect';
import type { UserSession } from '../auth/user-session';
import { BetterAuth } from '../auth/better-auth';
import { InternalError, UnauthorizedError } from '../effect/domain-errors';

export class SessionUnauthorized extends UnauthorizedError(
  'SessionUnauthorized',
) {}

export class SessionInfrastructureError extends InternalError(
  'SessionInfrastructureError',
)<{
  readonly cause?: unknown;
}> {}

export const getRequestHeaders: Effect.Effect<
  globalThis.Headers,
  never,
  HttpServerRequest.HttpServerRequest
> = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request) => new globalThis.Headers(Object.entries(request.headers)),
);

export const getOptionalSession = Effect.gen(function* () {
  const betterAuth = yield* BetterAuth;
  const requestHeaders = yield* getRequestHeaders;

  const session = yield* Effect.tryPromise({
    try: () => betterAuth.api.getSession({ headers: requestHeaders }),
    catch: (cause) =>
      new SessionInfrastructureError({
        cause,
        messageKey: 'session.resolveFailed',
      }),
  });

  if (!session) {
    return null;
  }

  return {
    ...session,
    session: {
      ...session.session,
      activeOrganizationId:
        (
          session.session as typeof session.session & {
            activeOrganizationId?: string | null;
          }
        ).activeOrganizationId ?? null,
    },
    user: {
      ...session.user,
      role: session.user.role ?? undefined,
    },
  } as UserSession;
});

export const requireSession = Effect.flatMap(getOptionalSession, (session) =>
  session
    ? Effect.succeed(session)
    : Effect.fail(
        new SessionUnauthorized({
          messageKey: 'auth.unauthorized',
        }),
      ),
);
