/**
 * Unit tests for `HealthService`.
 *
 * Covers the three liveness/readiness methods exposed by the service:
 *   - `live`        — always-ok heartbeat, no I/O.
 *   - `ready`       — database ping only (SELECT 1).
 *   - `healthCheck` — database ping + BETTER_AUTH_SECRET env-var presence.
 *
 * Uses `@effect/vitest` `it.effect` style and mocks `DrizzleDatabase` +
 * `BetterAuth` as per-test layers. The service body calls `db.execute(...)`
 * and reads Better Auth secret presence through AppConfig, so the mocks target
 * those two touch points specifically.
 */
import { afterEach, describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { vi } from 'vitest';
import { HealthService } from './service';
import { DrizzleDatabase, type DrizzleDb } from '../../platform/db/drizzle';
import { makeBetterAuthTestLayer } from '../../testing/better-auth-test';

/**
 * Minimal `DrizzleDb` stub — `HealthService` only calls `db.execute(sql)`.
 * `resolve` lets the test choose whether the SELECT 1 succeeds or rejects.
 */
const makeDbMock = (resolve: () => Promise<unknown>): DrizzleDb =>
  ({
    execute: vi.fn(resolve),
  }) as unknown as DrizzleDb;

const provide = (db: DrizzleDb) =>
  Effect.provide(
    HealthService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(DrizzleDatabase, db),
          makeBetterAuthTestLayer(),
        ),
      ),
    ),
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('HealthService', () => {
  describe('live', () => {
    it.effect('returns status "ok" with empty info/error/details', () => {
      const db = makeDbMock(async () => []);
      return Effect.gen(function* () {
        const svc = yield* HealthService;
        const result = yield* svc.live;
        expect(result.status).toBe('ok');
        expect(result.info).toEqual({});
        expect(result.error).toEqual({});
        expect(result.details).toEqual({});
        // `live` must not touch the database.
        expect(db.execute as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
      }).pipe(provide(db));
    });
  });

  describe('ready', () => {
    it.effect('reports database up when SELECT 1 succeeds', () => {
      const db = makeDbMock(async () => [{ '?column?': 1 }]);
      return Effect.gen(function* () {
        const svc = yield* HealthService;
        const result = yield* svc.ready;
        expect(result.status).toBe('ok');
        expect(result.info).toEqual({ database: { status: 'up' } });
        expect(result.error).toEqual({});
        expect(result.details.database).toEqual({ status: 'up' });
        expect(db.execute).toHaveBeenCalledTimes(1);
      }).pipe(provide(db));
    });

    it.effect('reports database down when SELECT 1 rejects', () => {
      const db = makeDbMock(async () => {
        throw new Error('connection refused');
      });
      return Effect.gen(function* () {
        const svc = yield* HealthService;
        const result = yield* svc.ready;
        expect(result.status).toBe('error');
        expect(result.info).toEqual({});
        expect(result.error.database).toMatchObject({
          status: 'down',
          messageKey: 'health.databaseUnreachable',
        });
        expect(result.details.database).toMatchObject({
          status: 'down',
          messageKey: 'health.databaseUnreachable',
        });
      }).pipe(provide(db));
    });
  });

  describe('healthCheck', () => {
    it.effect('reports ok when DB is up and BETTER_AUTH_SECRET is set', () => {
      vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret');
      const db = makeDbMock(async () => [{ '?column?': 1 }]);
      return Effect.gen(function* () {
        const svc = yield* HealthService;
        const result = yield* svc.healthCheck;
        expect(result.status).toBe('ok');
        expect(result.info).toEqual({
          database: { status: 'up' },
          'better-auth': {
            status: 'up',
            messageKey: 'health.betterAuthConfigured',
          },
        });
        expect(result.error).toEqual({});
      }).pipe(provide(db));
    });

    it.effect('reports error when BETTER_AUTH_SECRET is missing', () => {
      vi.stubEnv('BETTER_AUTH_SECRET', '');
      const db = makeDbMock(async () => [{ '?column?': 1 }]);
      return Effect.gen(function* () {
        const svc = yield* HealthService;
        const result = yield* svc.healthCheck;
        expect(result.status).toBe('error');
        expect(result.info).toEqual({ database: { status: 'up' } });
        expect(result.error['better-auth']).toMatchObject({
          status: 'down',
          messageKey: 'health.betterAuthSecretMissing',
        });
      }).pipe(provide(db));
    });

    it.effect(
      'reports both checks down when DB fails and secret missing',
      () => {
        vi.stubEnv('BETTER_AUTH_SECRET', '');
        const db = makeDbMock(async () => {
          throw new Error('db down');
        });
        return Effect.gen(function* () {
          const svc = yield* HealthService;
          const result = yield* svc.healthCheck;
          expect(result.status).toBe('error');
          expect(result.info).toEqual({});
          expect(result.error.database).toMatchObject({
            status: 'down',
            messageKey: 'health.databaseUnreachable',
          });
          expect(result.error['better-auth']).toMatchObject({
            status: 'down',
            messageKey: 'health.betterAuthSecretMissing',
          });
          expect(Object.keys(result.details)).toEqual(
            expect.arrayContaining(['database', 'better-auth']),
          );
        }).pipe(provide(db));
      },
    );
  });
});
