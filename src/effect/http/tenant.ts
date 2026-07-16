import type { HttpApp } from '@effect/platform';
import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import { Effect } from 'effect';
import {
  CurrentRequestActor,
  makeRequestActor,
} from '../platform/auth/request-actor';
import { requireSession } from '../platform/http/session';
import { resolveRequestHost } from '../platform/tenancy/host';
import {
  resolvePublicTenantForHost,
  resolveTenantForHostAndSession,
} from '../platform/tenancy/tenant-context';

const getPathname = (url: string) => {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    const queryIndex = url.indexOf('?');
    return queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  }
};

const isPublicApiRoute = (
  request: HttpServerRequest.HttpServerRequest,
  pathname: string,
) =>
  request.method === 'GET' &&
  (pathname === '/api/v1/branding' || pathname === '/api/v1/branding/');

const isBypassedRoute = (pathname: string) =>
  pathname === '/health-check' ||
  pathname.startsWith('/health-check/') ||
  pathname === '/docs' ||
  pathname.startsWith('/docs/') ||
  pathname === '/api/auth' ||
  pathname.startsWith('/api/auth/') ||
  pathname === '/api/v1/superadmin' ||
  pathname.startsWith('/api/v1/superadmin/') ||
  pathname === '/api/v1/platform/tls/ask' ||
  pathname === '/api/v1/e2e/seed';

const requiresTenantContext = (
  request: HttpServerRequest.HttpServerRequest,
) => {
  const pathname = getPathname(request.url);

  if (request.method === 'OPTIONS' || isBypassedRoute(pathname)) {
    return false;
  }

  return pathname === '/api/v1' || pathname.startsWith('/api/v1/');
};

export const tenantContextMiddleware = <E, R>(httpApp: HttpApp.Default<E, R>) =>
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
    if (!requiresTenantContext(request)) {
      return httpApp;
    }

    return Effect.gen(function* () {
      const host = resolveRequestHost(request);
      const pathname = getPathname(request.url);

      if (isPublicApiRoute(request, pathname)) {
        yield* resolvePublicTenantForHost(host);
        return yield* httpApp;
      }

      yield* resolvePublicTenantForHost(host);
      const session = yield* requireSession;
      const tenant = yield* resolveTenantForHostAndSession(host, session);
      return yield* Effect.provideService(
        httpApp,
        CurrentRequestActor,
        makeRequestActor(session, tenant),
      );
    });
  });
