# `backend/src/effect/testing/` — test harness

Shared primitives for backend Vitest specs. Import everything from
`src/effect/testing/test-harness` (which re-exports the pieces you need)
or reach into the individual modules when you want to compose by hand.

## When to use what

| You are writing...                                                 | Use                                                                     |
|--------------------------------------------------------------------|-------------------------------------------------------------------------|
| Pure unit tests on a service with mocked repos / peer services     | `makeTestLayer(tag)({...})` + `it.effect` or plain `it`                 |
| Integration tests that hit Postgres                                | `withTestDb()` + `testPlatformLayer` + `runTest` / `runTestFailure`     |
| Router tests (`HttpApp.toWebHandler`)                              | `vi.mock('./service', ...)` like `modules/auth/router.spec.ts`          |
| Anything touching `UsersService` / `BetterAuth.api`                | `makeBetterAuthTestLayer({ users: [...] })`                             |
| Photo tests once LIB-176 lands (forward-looking)                   | `makeInMemoryStorageAdapter()` / `makeInMemoryStorageAdapterLayer()`    |

### `it.effect` vs `it` + `Effect.runPromise`

- **`it.effect` (preferred going forward)** — the test body **is** an
  Effect. Failures in the error channel fail the test; no
  `runPromise` escape hatch. See
  `src/effect/modules/products/service.effect.spec.ts` and
  `src/effect/modules/branding/service.effect.spec.ts`.
- **Plain `it` + `Effect.runPromise`** — still fine for legacy specs
  and for tests that mix non-Effect setup with Effect execution
  (e.g. most existing integration specs). Don't rewrite working
  tests just to change the harness.

## DB bootstrap (integration tests)

1. `vitest.integration.config.ts` runs `src/effect/test/integration-global-setup.ts`
   **once per run**. That script:
   - creates `stocket_inventory_test` if absent,
   - applies the committed SQL migrations used by application startup.
2. The harness opens **one shared `pg.Pool`** on first `getTestDb()` call.
3. Before every test, `truncateAll()` wipes every domain table with
   `TRUNCATE ... CASCADE` and resets `order_number_seq`.
4. On `afterAll`, `closeTestDb()` ends the pool.

`withTestDb()` wires those hooks for you.

### Test data

Use the `seed*` helpers from `../test/seed` (re-exported from
`test-harness`). They insert minimal valid rows with sensible
defaults and accept overrides. The two well-known fake user UUIDs —
`TEST_USER_ID` and `TEST_USER_ID_2` — are for `created_by` / `user_id`
foreign keys where a real Better Auth user isn't needed.

## Better Auth stubbing

`UsersService` is the only consumer of `BetterAuth.api` in production
code. For unit tests, follow the pattern in
`modules/users/service.spec.ts` — `vi.mock('../../platform/auth/better-auth', ...)`.
For integration / router tests where you want a real layer graph, use:

```ts
import { makeBetterAuthTestLayer, makeFakeBetterAuthUser } from './better-auth-test';

const authLayer = makeBetterAuthTestLayer({
  users: [makeFakeBetterAuthUser({ id: 'user-1', name: 'Jane' })],
});
```

Override individual methods (e.g., to assert calls) via
`overrides: { banUser: vi.fn().mockResolvedValue(undefined) }`.

No env var is required — the stub does not touch `BETTER_AUTH_SECRET`
or the real `auth` module.

## Skeleton to copy-paste (unit test)

```ts
import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { makeTestLayer } from '../../testing/test-harness';
import { MyRepository } from './repository';
import { MyService } from './service';

const repoLayer = (overrides: Partial<MyRepository> = {}) =>
  makeTestLayer(MyRepository)({
    findById: () => Effect.succeed(null),
    ...overrides,
  });

describe('MyService', () => {
  it.effect('does the thing', () =>
    Effect.gen(function* () {
      const svc = yield* MyService;
      const result = yield* svc.doTheThing('abc');
      expect(result).toBeDefined();
    }).pipe(
      Effect.provide(
        MyService.DefaultWithoutDependencies.pipe(Layer.provide(repoLayer())),
      ),
    ),
  );
});
```

## Skeleton to copy-paste (integration test)

```ts
import { Effect, Layer } from 'effect';
import { MyService } from './service';
import {
  getTestDb,
  makeTestDrizzleLayer,
  runTest,
  runTestFailure,
  seedCategory,
  withTestDb,
} from '../../testing/test-harness';

let TestLayer: Layer.Layer<MyService>;

withTestDb();
beforeAll(() => {
  TestLayer = MyService.Default.pipe(Layer.provide(makeTestDrizzleLayer()));
});

describe('MyService Integration', () => {
  it('creates X', async () => {
    const db = getTestDb();
    const cat = await seedCategory(db);
    const result = await runTest(
      Effect.flatMap(MyService, (s) => s.create({ categoryId: cat.id })),
      TestLayer,
    );
    expect(result.category_id).toBe(cat.id);
  });
});
```

## Files at a glance

- `test-harness.ts` — entry point; `testPlatformLayer`, `runTest`,
  `runTestFailure`, `withTestDb`, plus re-exports of seeds and
  `makeTestLayer`.
- `better-auth-test.ts` — `makeBetterAuthStub`,
  `makeBetterAuthTestLayer`, `makeFakeBetterAuthUser`.
- `storage-adapter-test.ts` — re-exports the platform `StorageAdapter`
  test helpers, including `makeInMemoryStorageAdapter` and
  `makeInMemoryStorageAdapterLayer`.

## Legacy `src/effect/test/`

The older `test/` directory (`integration-layer.ts`, `seed.ts`,
`utils.ts`) still exists and is the concrete implementation behind
this harness. New code should import from `testing/test-harness` —
don't import from `../test/*` in new specs unless you need a piece
that isn't re-exported yet (please add it instead).
