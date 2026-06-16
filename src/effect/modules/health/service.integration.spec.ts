/**
 * Integration tests for `HealthService`.
 *
 * Exercises `live`, `ready`, and `healthCheck` against the real test DB
 * (via `makeTestDrizzleLayer()`) plus the stubbed Better Auth layer from
 * the shared test harness.
 *
 * DB-down coverage: the service's `checkDatabase` step runs
 * `db.execute(sql\`SELECT 1\`)` and folds any rejection into a `down`
 * detail via `Effect.merge`. To simulate unavailability without touching
 * the shared integration pool, we build a *separate* Drizzle instance
 * backed by a `pg.Pool` pointed at an unroutable port, provide it as an
 * alternate `DrizzleDatabase` layer, and rebuild the service on top. The
 * shared test DB is untouched.
 *
 * Notes on what is intentionally NOT covered here:
 *   - Mid-run pool termination. The service captures `db` once at
 *     layer-build time, and the integration harness owns the real pool;
 *     calling `pool.end()` on it would poison every other integration
 *     spec sharing the DB. The bad-config approach above exercises the
 *     same error branch deterministically.
 *   - `BETTER_AUTH_SECRET` missing → `better-auth` down. `test/setup-env.ts`
 *     seeds this variable for the whole vitest process, so we delete it
 *     for a single test (then restore it) inside a scoped `describe`.
 */
import { Effect, Layer } from 'effect';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleDatabase, type DrizzleDb } from '../../platform/db/drizzle';
import * as schema from '../../platform/db/schema';
import * as relations from '../../platform/db/relations';
import {
  makeTestDrizzleLayer,
  runTest,
  withTestDb,
} from '../../testing/test-harness';
import { makeBetterAuthTestLayer } from '../../testing/better-auth-test';
import { HealthService } from './service';

withTestDb();

/**
 * Service layer built against the real shared test DB + stubbed Better Auth.
 * Rebuilt in a `beforeAll` to ensure the pool is live before `HealthService`
 * captures the `db` reference at layer-build time.
 */
let HealthyLayer: Layer.Layer<HealthService>;

beforeAll(() => {
  HealthyLayer = HealthService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(makeTestDrizzleLayer(), makeBetterAuthTestLayer()),
    ),
  );
});

describe('HealthService Integration', () => {
  describe('live', () => {
    it('always reports status ok with no DB dependency', async () => {
      const response = await runTest(
        Effect.flatMap(HealthService, (svc) => svc.live),
        HealthyLayer,
      );

      expect(response.status).toBe('ok');
      expect(response.info).toEqual({});
      expect(response.error).toEqual({});
      expect(response.details).toEqual({});
    });
  });

  describe('ready (healthy DB)', () => {
    it('returns status ok and database up when SELECT 1 succeeds', async () => {
      const response = await runTest(
        Effect.flatMap(HealthService, (svc) => svc.ready),
        HealthyLayer,
      );

      expect(response.status).toBe('ok');
      expect(response.details.database).toMatchObject({ status: 'up' });
      expect(response.info.database).toMatchObject({ status: 'up' });
      expect(response.error).toEqual({});
    });
  });

  describe('healthCheck (healthy DB + BETTER_AUTH_SECRET set)', () => {
    it('reports both database and better-auth up', async () => {
      // `test/setup-env.ts` always seeds BETTER_AUTH_SECRET before vitest
      // boots; this test verifies the happy path where both checks pass.
      expect(process.env.BETTER_AUTH_SECRET).toBeTruthy();

      const response = await runTest(
        Effect.flatMap(HealthService, (svc) => svc.healthCheck),
        HealthyLayer,
      );

      expect(response.status).toBe('ok');
      expect(response.details.database).toMatchObject({ status: 'up' });
      expect(response.details['better-auth']).toMatchObject({
        status: 'up',
        messageKey: 'health.betterAuthConfigured',
      });
      expect(response.error).toEqual({});
    });
  });

  describe('healthCheck with BETTER_AUTH_SECRET missing', () => {
    let previousSecret: string | undefined;

    beforeAll(() => {
      previousSecret = process.env.BETTER_AUTH_SECRET;
      delete process.env.BETTER_AUTH_SECRET;
    });

    afterAll(() => {
      if (previousSecret !== undefined) {
        process.env.BETTER_AUTH_SECRET = previousSecret;
      }
    });

    it('reports better-auth down while database stays up', async () => {
      const response = await runTest(
        Effect.flatMap(HealthService, (svc) => svc.healthCheck),
        HealthyLayer,
      );

      expect(response.status).toBe('error');
      expect(response.details.database).toMatchObject({ status: 'up' });
      expect(response.details['better-auth']).toMatchObject({
        status: 'down',
        messageKey: 'health.betterAuthSecretMissing',
      });
      expect(response.error['better-auth']).toMatchObject({ status: 'down' });
      // Database stays in info because it's still up.
      expect(response.info.database).toMatchObject({ status: 'up' });
    });
  });

  describe('ready (DB unreachable)', () => {
    // Build a separate Drizzle instance pointed at an unroutable endpoint.
    // This isolates the failure simulation from the shared test pool.
    let deadPool: pg.Pool;
    let DeadDbLayer: Layer.Layer<DrizzleDb>;
    let UnhealthyLayer: Layer.Layer<HealthService>;

    beforeAll(() => {
      // Port 1 with a 500ms connect timeout — guaranteed refusal on localhost.
      deadPool = new pg.Pool({
        host: '127.0.0.1',
        port: 1,
        user: 'nobody',
        password: 'nobody',
        database: 'nobody',
        connectionTimeoutMillis: 500,
        max: 1,
      });
      // Swallow pool-level 'error' events — without a listener node logs them
      // and some environments treat them as unhandled. We *want* errors here.
      deadPool.on('error', () => {});

      const deadDb = drizzle(deadPool, {
        schema: { ...schema, ...relations },
      }) as unknown as DrizzleDb;

      DeadDbLayer = Layer.succeed(DrizzleDatabase, deadDb);
      UnhealthyLayer = HealthService.Default.pipe(
        Layer.provide(Layer.mergeAll(DeadDbLayer, makeBetterAuthTestLayer())),
      );
    });

    afterAll(async () => {
      await deadPool.end().catch(() => {});
    });

    it('returns status error with database down when the pool cannot connect', async () => {
      const response = await runTest(
        Effect.flatMap(HealthService, (svc) => svc.ready),
        UnhealthyLayer,
      );

      expect(response.status).toBe('error');
      expect(response.details.database).toMatchObject({
        status: 'down',
        messageKey: 'health.databaseUnreachable',
      });
      expect(response.error.database).toMatchObject({ status: 'down' });
      expect(response.info).toEqual({});
    });

    it('healthCheck surfaces database down and marks overall status error', async () => {
      const response = await runTest(
        Effect.flatMap(HealthService, (svc) => svc.healthCheck),
        UnhealthyLayer,
      );

      expect(response.status).toBe('error');
      expect(response.details.database).toMatchObject({
        status: 'down',
        messageKey: 'health.databaseUnreachable',
      });
      // Better Auth is still up because the env var is set for this describe block.
      expect(response.details['better-auth']).toMatchObject({ status: 'up' });
      expect(response.error.database).toMatchObject({ status: 'down' });
    });

    it('live still reports ok even when the DB layer is broken (no I/O path)', async () => {
      const response = await runTest(
        Effect.flatMap(HealthService, (svc) => svc.live),
        UnhealthyLayer,
      );

      expect(response.status).toBe('ok');
      expect(response.details).toEqual({});
    });
  });
});
