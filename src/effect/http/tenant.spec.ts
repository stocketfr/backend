import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { BetterAuthService } from '../platform/auth/better-auth';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../platform/http/request-context';
import { respondCause } from '../platform/http/errors';
import { DEFAULT_TENANT_ID } from '../platform/tenancy/tenant-context';
import { makeBetterAuthTestLayer } from '../testing/better-auth-test';
import { tenantContextMiddleware } from './tenant';

const TEST_USER_ID = '00000000-0000-4000-a000-000000000001';
const TENANT_HOST = 'stocket.stocket.fr';
const PLATFORM_HOST = 'app.stocket.fr';
const tenantUrl = (path: string) => `http://${TENANT_HOST}${path}`;
const platformUrl = (path: string) => `http://${PLATFORM_HOST}${path}`;

const makeSession = () => ({
  user: {
    id: TEST_USER_ID,
    name: 'Tenant Test User',
    email: 'tenant@example.com',
    image: null,
    emailVerified: true,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-10T12:00:00.000Z'),
    role: 'admin',
  },
  session: {
    id: 'session-tenant',
    userId: TEST_USER_ID,
    token: 'tok',
    createdAt: new Date('2026-03-10T12:00:00.000Z'),
    updatedAt: new Date('2026-03-10T12:00:00.000Z'),
    expiresAt: new Date('2026-03-17T12:00:00.000Z'),
    activeOrganizationId: null,
  },
});

const makeRequestLayer = (url: string, method = 'GET') => {
  const { host } = new URL(url);
  return Layer.succeed(
    HttpServerRequest.HttpServerRequest,
    HttpServerRequest.fromWeb(new Request(url, { method, headers: { host } })),
  );
};

const makeRequestContext = (path: string): RequestContext => ({
  requestId: '00000000-0000-4000-8000-000000000099',
  path,
  method: 'GET',
  ip: null,
  locale: 'en',
});

const okApp = HttpServerResponse.text('ok');

const makeBetterAuthLayer = (getSession: ReturnType<typeof vi.fn>) =>
  makeBetterAuthTestLayer({
    overrides: {
      getSession,
    } as unknown as Partial<BetterAuthService['api']>,
  });

const provideTestRequest = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  url: string,
  getSession: ReturnType<typeof vi.fn>,
  requestContext?: RequestContext,
) => {
  let provided = effect.pipe(
    Effect.provide(makeRequestLayer(url)),
    Effect.provide(makeBetterAuthLayer(getSession)),
  );

  if (requestContext) {
    provided = provided.pipe(
      Effect.provide(Layer.succeed(CurrentRequestContext, requestContext)),
    );
  }

  return provided;
};

const makeEffect = (
  url: string,
  getSession: ReturnType<typeof vi.fn>,
  requestContext?: RequestContext,
) => provideTestRequest(
  tenantContextMiddleware(okApp),
  url,
  getSession,
  requestContext,
);

const makeCaughtEffect = (
  url: string,
  getSession: ReturnType<typeof vi.fn>,
) => provideTestRequest(
  tenantContextMiddleware(okApp).pipe(Effect.catchAllCause(respondCause)),
  url,
  getSession,
);

const run = (
  url: string,
  getSession: ReturnType<typeof vi.fn>,
  requestContext?: RequestContext,
) => Effect.runPromise(makeEffect(url, getSession, requestContext));

describe('tenantContextMiddleware', () => {
  it('does not resolve tenant context for Better Auth routes', async () => {
    const getSession = vi.fn();

    const response = await run(
      platformUrl('/api/auth/sign-in'),
      getSession,
    );
    expect(response.status).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('does not resolve tenant context for CORS preflight requests', async () => {
    const getSession = vi.fn();
    const effect = tenantContextMiddleware(okApp).pipe(
      Effect.provide(
        makeRequestLayer(tenantUrl('/api/v1/products'), 'OPTIONS'),
      ),
      Effect.provide(makeBetterAuthLayer(getSession)),
    );

    const response = await Effect.runPromise(effect);
    expect(response.status).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('does not require a session for the public branding endpoint', async () => {
    const getSession = vi.fn(async () => null);

    const response = await run(
      tenantUrl('/api/v1/branding'),
      getSession,
    );

    expect(response.status).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('rejects protected API requests without a session', async () => {
    const getSession = vi.fn(async () => null);

    const error = await Effect.runPromise(
        makeEffect(tenantUrl('/api/v1/products'), getSession).pipe(
        Effect.flip,
      ),
    );

    expect(error).toMatchObject({ _tag: 'SessionUnauthorized' });
  });

  it('can be caught into a 401 response when it rejects before the router runs', async () => {
    const getSession = vi.fn(async () => null);

    const response = await Effect.runPromise(
      makeCaughtEffect(tenantUrl('/api/v1/products'), getSession),
    );

    expect(response.status).toBe(401);
  });

  it('resolves and stores tenant context for protected API requests', async () => {
    const getSession = vi.fn(async () => makeSession());
    const requestContext = makeRequestContext('/api/v1/products');

    const response = await run(
      tenantUrl('/api/v1/products'),
      getSession,
      requestContext,
    );

    expect(response.status).toBe(200);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(requestContext.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('rejects unknown hosts before loading a session', async () => {
    const getSession = vi.fn(async () => makeSession());

    const response = await Effect.runPromise(
      makeCaughtEffect('http://unknown.example.com/api/v1/products', getSession),
    );

    expect(response.status).toBe(404);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('does not resolve tenant context for superadmin routes', async () => {
    const getSession = vi.fn();

    const response = await run(
      platformUrl('/api/v1/superadmin/me'),
      getSession,
    );

    expect(response.status).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
  });
});
