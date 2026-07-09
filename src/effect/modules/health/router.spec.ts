/**
 * Router tests for the `/health-check` HTTP boundary.
 *
 * The health module is built on `HttpApiBuilder` (typed, schema-validated
 * routes) rather than `HttpRouter`. We compose it with
 * `HttpApiBuilder.toWebHandler` + `HttpServer.layerContext`, mirroring
 * `http/app.ts`, and provide a mock `HealthService` per test.
 *
 * The 4-test template is adjusted because:
 *   - Health endpoints are intentionally **public** (no `requirePermission`),
 *     so the guard test is omitted.
 *   - The routes have no path/body/query params, so there's no decode
 *     failure surface on the HTTP boundary.
 *
 * That leaves two failure modes per route: service-level `ok` (200) and
 * service-level `error` (503 via the `ServiceDown` schema-tagged error).
 * Those two, exercised across the three endpoints, plus a targeted live
 * path give us seven tests that match the spirit of the template.
 */
import { describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';
import { HttpApiBuilder, HttpServer } from '@effect/platform';
import { AppApi } from '../../http/api';
import { HealthApiLive } from './router';
import { HealthService } from './service';
import type { HealthCheckResponse } from './types';

const okResponse = (
  details: HealthCheckResponse['details'] = {},
): HealthCheckResponse => ({
  status: 'ok',
  info: Object.fromEntries(
    Object.entries(details).filter(([, v]) => v.status === 'up'),
  ),
  error: {},
  details,
});

const errorResponse = (
  details: HealthCheckResponse['details'],
): HealthCheckResponse => ({
  status: 'error',
  info: Object.fromEntries(
    Object.entries(details).filter(([, v]) => v.status === 'up'),
  ),
  error: Object.fromEntries(
    Object.entries(details).filter(([, v]) => v.status === 'down'),
  ),
  details,
});

interface HealthServiceMock {
  readonly live?: Effect.Effect<HealthCheckResponse>;
  readonly ready?: Effect.Effect<HealthCheckResponse>;
  readonly healthCheck?: Effect.Effect<HealthCheckResponse>;
}

const healthServiceLayer = (mock: HealthServiceMock) =>
  Layer.succeed(HealthService, {
    live: mock.live ?? Effect.succeed(okResponse()),
    ready: mock.ready ?? Effect.succeed(okResponse()),
    healthCheck: mock.healthCheck ?? Effect.succeed(okResponse()),
  } as any);

const makeHandler = (mock: HealthServiceMock) => {
  // Replicates the `apiLayer` composition from `http/app.ts`, but with a
  // stubbed HealthService so tests stay unit-scope.
  const apiLayer = Layer.provide(HttpApiBuilder.api(AppApi), [
    HealthApiLive.pipe(Layer.provide(healthServiceLayer(mock))),
  ]);

  const { handler } = HttpApiBuilder.toWebHandler(
    Layer.mergeAll(apiLayer, HttpServer.layerContext),
  );
  return handler;
};

// These tests bypass HttpRouter.mountApp('/health-check', ...) and exercise
// the group directly, so request paths are relative to the group (e.g. /live)
// rather than the public URL (/health-check/live).
describe('HealthApiLive', () => {
  describe('GET /live (public: /health-check/live)', () => {
    it('returns 200 with status ok', async () => {
      const handler = makeHandler({ live: Effect.succeed(okResponse()) });
      const response = await handler(new Request('http://localhost/live'));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: 'ok',
      });
    });
  });

  describe('GET /ready (public: /health-check/ready)', () => {
    it('returns 200 when the service reports ok', async () => {
      const handler = makeHandler({
        ready: Effect.succeed(okResponse({ database: { status: 'up' } })),
      });
      const response = await handler(new Request('http://localhost/ready'));
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.status).toBe('ok');
      expect(body.details.database.status).toBe('up');
    });

    it('returns 503 (ServiceDown) when the service reports error', async () => {
      const handler = makeHandler({
        ready: Effect.succeed(
          errorResponse({
            database: {
              status: 'down',
              messageKey: 'health.databaseUnreachable',
            },
          }),
        ),
      });
      const response = await handler(new Request('http://localhost/ready'));
      expect(response.status).toBe(503);
      const body = (await response.json()) as any;
      expect(body.details.database.status).toBe('down');
    });
  });

  describe('GET / (public: /health-check)', () => {
    it('returns 200 with combined details when everything is up', async () => {
      const handler = makeHandler({
        healthCheck: Effect.succeed(
          okResponse({
            database: { status: 'up' },
            'better-auth': {
              status: 'up',
              messageKey: 'health.betterAuthConfigured',
            },
          }),
        ),
      });
      const response = await handler(new Request('http://localhost/'));
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.status).toBe('ok');
      expect(body.details.database.status).toBe('up');
      expect(body.details['better-auth'].status).toBe('up');
    });

    it('returns 503 with failing components surfaced in details', async () => {
      const handler = makeHandler({
        healthCheck: Effect.succeed(
          errorResponse({
            database: {
              status: 'down',
              messageKey: 'health.databaseUnreachable',
            },
            'better-auth': {
              status: 'down',
              messageKey: 'health.betterAuthSecretMissing',
            },
          }),
        ),
      });
      const response = await handler(new Request('http://localhost/'));
      expect(response.status).toBe(503);
      const body = (await response.json()) as any;
      expect(body.details.database.status).toBe('down');
      expect(body.details['better-auth'].status).toBe('down');
    });

    it('returns 503 with partial failure when only database is down', async () => {
      const handler = makeHandler({
        healthCheck: Effect.succeed(
          errorResponse({
            database: {
              status: 'down',
              messageKey: 'health.databaseUnreachable',
            },
            'better-auth': {
              status: 'up',
              messageKey: 'health.betterAuthConfigured',
            },
          }),
        ),
      });
      const response = await handler(new Request('http://localhost/'));
      expect(response.status).toBe(503);
      const body = (await response.json()) as any;
      expect(body.details.database.status).toBe('down');
      expect(body.details['better-auth'].status).toBe('up');
    });
  });

  describe('unknown routes', () => {
    it('returns 404 for an unknown path', async () => {
      const handler = makeHandler({});
      const response = await handler(
        new Request('http://localhost/does-not-exist'),
      );
      expect(response.status).toBe(404);
    });
  });
});
