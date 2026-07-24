import { HttpServerResponse } from '@effect/platform';
import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import type { HttpApp } from '@effect/platform';
import { Effect } from 'effect';
import { findTenantByHostname } from '../platform/db/tenant-queries';
import { DrizzleDatabase } from '../platform/db/drizzle';
import { isPlatformHost, normalizeHost } from '../platform/tenancy/host';
import type { AppConfigShape } from '../platform/config/app-config';

const CORS_MAX_AGE_SECONDS = 86_400;

const createCorsConfig = (appConfig: AppConfigShape) => {
  const origins = appConfig.corsOrigins;

  if (origins.length === 0) {
    throw new Error('CORS_ORIGIN must contain at least one origin');
  }

  if (appConfig.isProduction && origins.includes('*')) {
    throw new Error(
      'CORS_ORIGIN must be set to specific origins in production (not "*")',
    );
  }

  const isConfiguredOriginAllowed = (origin: string) => {
    if (!appConfig.isProduction && origins.includes('*')) {
      return origin.length > 0;
    }

    return origins.includes(origin);
  };

  return { isConfiguredOriginAllowed };
};

const ALLOWED_METHODS = 'GET, HEAD, PUT, PATCH, POST, DELETE';

const hostnameFromOrigin = (origin: string) => {
  try {
    return normalizeHost(new URL(origin).host);
  } catch {
    return null;
  }
};

const isVerifiedTenantOrigin = (appConfig: AppConfigShape, origin: string) =>
  Effect.gen(function* () {
    const hostname = hostnameFromOrigin(origin);
    if (!hostname) return false;
    if (isPlatformHost(hostname)) return true;

    const db = yield* DrizzleDatabase;
    const rows = yield* Effect.tryPromise(() =>
      findTenantByHostname(db, hostname, appConfig),
    ).pipe(Effect.catchAll(() => Effect.succeed([])));

    return rows.length > 0;
  });

const isAllowedOrigin = (
  appConfig: AppConfigShape,
  isConfiguredOriginAllowed: (origin: string) => boolean,
  origin: string,
) =>
  isConfiguredOriginAllowed(origin)
    ? Effect.succeed(true)
    : isVerifiedTenantOrigin(appConfig, origin);

const getCorsHeaders = (origin: string): Record<string, string> => ({
  'access-control-allow-origin': origin,
  'access-control-allow-credentials': 'true',
  'access-control-expose-headers': 'X-Request-Id',
  vary: 'Origin',
});

const getPreflightHeaders = (
  origin: string,
  accessControlRequestHeaders?: string,
): Record<string, string> => ({
  'access-control-allow-origin': origin,
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': ALLOWED_METHODS,
  ...(accessControlRequestHeaders
    ? { 'access-control-allow-headers': accessControlRequestHeaders }
    : {}),
  'access-control-max-age': String(CORS_MAX_AGE_SECONDS),
  vary: 'Origin, Access-Control-Request-Headers',
});

export const corsMiddleware =
  (appConfig: AppConfigShape) =>
  <E, R>(httpApp: HttpApp.Default<E, R>) => {
    const { isConfiguredOriginAllowed } = createCorsConfig(appConfig);
    return Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      Effect.gen(function* () {
        const { origin } = request.headers;
        const originAllowed = origin
          ? yield* isAllowedOrigin(appConfig, isConfiguredOriginAllowed, origin)
          : false;

        if (request.method === 'OPTIONS' && origin && originAllowed) {
          const accessControlRequestHeaders =
            request.headers['access-control-request-headers'];
          return HttpServerResponse.empty({
            status: 204,
            headers: getPreflightHeaders(
              origin,
              typeof accessControlRequestHeaders === 'string'
                ? accessControlRequestHeaders
                : undefined,
            ),
          });
        }

        if (!origin || !originAllowed) {
          return yield* httpApp;
        }

        return yield* Effect.map(httpApp, (response) =>
          HttpServerResponse.setHeaders(response, getCorsHeaders(origin)),
        );
      }),
    );
  };
