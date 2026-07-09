/**
 * Shared test harness for the Effect-TS backend.
 *
 * Exposes:
 *   - `testPlatformLayer`        — Drizzle + BetterAuth wired for tests, mirroring
 *                                  `platformLayer` in `src/effect/main.ts`.
 *   - `provideTestLayer(...)`    — convenience: `Effect.provide(Layer.mergeAll(...))`
 *                                  with the test platform pre-merged.
 *   - `runTest` / `runTestFailure` — `Effect.runPromise` wrappers that always
 *                                  provide the test platform.
 *   - `withTestDb()` — idempotent hook registration for
 *                                  integration specs (uses Vitest globals).
 *
 * DB strategy: one PostgreSQL schema pushed via drizzle-kit at global-setup
 * time, one shared connection pool for the whole test run, and
 * `TRUNCATE ... CASCADE` before every test. See `./README.md`.
 *
 * Unit tests don't need the platform layer. Use `makeTestLayer(tag)({...})`
 * (re-exported below) to build typed mock layers per service.
 */
import { Effect, Layer } from 'effect';
import { DrizzleDatabase } from '../platform/db/drizzle';
import { BetterAuth, BetterAuthHeaders } from '../platform/auth/better-auth';
import { AppConfig } from '../platform/config/app-config';
import {
  closeTestDb,
  getTestDb,
  makeTestDrizzleLayer,
  truncateAll,
} from './integration-layer';
import { makeBetterAuthTestLayer } from './better-auth-test';

export { makeTestLayer, createChainableMock } from './utils';
export {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
  makeTestRequestContext,
} from './integration-layer';
export {
  TEST_USER_ID,
  TEST_USER_ID_2,
  seedArea,
  ensureBetterAuthUserTable,
  seedAuditLog,
  seedBetterAuthUser,
  seedCategory,
  seedClient,
  seedInventory,
  seedLocation,
  seedOrder,
  seedOrderItems,
  seedProduct,
  seedStockMovement,
  seedSupplier,
} from './seed';

/**
 * Default headers surfaced as `BetterAuthHeaders` when integration tests
 * call services that reach into Better Auth (e.g., `UsersService`).
 */
export const TEST_BETTER_AUTH_HEADERS = new Headers({
  authorization: 'Bearer test-token',
});

const betterAuthHeadersLayer = Layer.succeed(
  BetterAuthHeaders,
  TEST_BETTER_AUTH_HEADERS,
);

/**
 * Mirrors `platformLayer` in `main.ts` (Drizzle + BetterAuth), but with
 * test-appropriate implementations. Use this with
 * `YourService.Default.pipe(Layer.provide(testPlatformLayer))` for integration
 * tests that hit the real DB, or compose it with further mock layers.
 *
 * The Better Auth layer here is the **stubbed** one from
 * `./better-auth-test` — no network calls, no real session DB.
 */
export const testPlatformLayer = Layer.suspend(() =>
  Layer.mergeAll(
    AppConfig.Default,
    makeTestDrizzleLayer(),
    makeBetterAuthTestLayer(),
    betterAuthHeadersLayer,
  ),
);

/**
 * Helper: provide the test platform + any additional layers to an Effect.
 *
 * @example
 *   const TestLayer = CategoriesService.Default.pipe(
 *     Layer.provide(testPlatformLayer),
 *   );
 *   await runTest(Effect.flatMap(CategoriesService, (s) => s.findAll()), TestLayer);
 */
export const provideTestLayer =
  <R1>(...layers: ReadonlyArray<Layer.Layer<R1, never, never>>) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, Exclude<R, R1>> =>
    Effect.provide(
      effect,
      Layer.mergeAll(testPlatformLayer, ...layers) as Layer.Layer<
        R1,
        never,
        never
      >,
    );

/**
 * Run an Effect with a caller-supplied Layer providing the service(s).
 * Prefer this for integration tests; it exists to standardize the
 * `Effect.runPromise(eff.pipe(Effect.provide(Layer)))` dance.
 */
export const runTest = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>,
): Promise<A> => Effect.runPromise(Effect.provide(effect, layer));

/**
 * Like `runTest`, but flips the error channel so you can assert on the
 * tagged error returned by a service method.
 */
export const runTestFailure = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>,
): Promise<E> => Effect.runPromise(Effect.flip(Effect.provide(effect, layer)));

/**
 * Registers the canonical integration hooks (getTestDb on beforeAll,
 * closeTestDb on afterAll, truncateAll before every test).
 *
 * Relies on Vitest globals (`beforeAll`, `afterAll`, `beforeEach`) which are
 * enabled in both `vitest.config.ts` and `vitest.integration.config.ts`.
 */
let _testDbHooksRegistered = false;

export function withTestDb(): void {
  if (_testDbHooksRegistered) return;
  _testDbHooksRegistered = true;

  beforeAll(() => {
    getTestDb();
  });
  afterAll(() => closeTestDb());
  beforeEach(() => truncateAll());
}

// Re-export core tags for convenience — tests frequently need these.
export { DrizzleDatabase, BetterAuth, BetterAuthHeaders };
