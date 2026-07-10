# Testing guide — `@stocket/api`

This is the contributor-facing guide to writing tests for the backend. It covers every test flavor that currently exists on the platform and shows how to add more of them.

For deeper detail on the Effect test harness internals (layers, seeds, Better Auth stubs, storage adapters), see [`src/effect/testing/README.md`](./src/effect/testing/README.md). This document is the entry point; that one is the harness reference.

---

## 1. The five test flavors

| Flavor                 | File suffix                  | Runs with                 | Touches DB?         | Use when                                                                                                                   |
| ---------------------- | ---------------------------- | ------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Unit**               | `*.spec.ts`                  | `pnpm test`               | No                  | Testing a service, router, or pure function with mocked dependencies.                                                      |
| **Effect-native unit** | `*.effect.spec.ts`           | `pnpm test`               | No                  | New unit tests where the test body itself is an Effect (preferred for new code on services with simple wiring).            |
| **Property**           | `*.property.spec.ts`         | `pnpm test`               | No                  | Pure functions whose behavior is best expressed as an invariant ("for all inputs, X holds").                               |
| **Integration**        | `*.integration.spec.ts`      | `pnpm test:integration`   | Yes (real Postgres) | Testing a service through real Drizzle SQL, transactional behavior, or full HTTP-app composition.                          |
| **Mutation**           | n/a (re-runs existing specs) | `pnpm test:mutation:pure` | No                  | Optional quality check for pure utility files. Catches assertions that are too weak to detect off-by-one or boolean flips. |

There is also a **duplication check** (`pnpm test:duplicates`) — not a test flavor, but a signal for excessive copy-paste across spec files.

---

## 2. Choosing a flavor

Decision tree, in order:

1. **Is the function pure (no I/O, no Effect, no DB)?** → property test. Start with `messages.property.spec.ts` or `bulk-operation.utils.property.spec.ts` as templates.
2. **Is it a service method whose only collaborators are repositories / other services?** → unit test using `makeMockServiceLayer` + `makeServiceTestHarness` to inject mocks around the module under test. New code: prefer `it.effect`. Existing code: match the style of the neighboring `*.spec.ts`.
3. **Is it a router handler?** → unit test that `vi.mock`s the service module so the router gets a fresh tag; assert the HTTP `Response`. Pattern: `modules/inventory/router.spec.ts`.
4. **Does correctness depend on real SQL behavior** — joins, transactional rollback, `ON CONFLICT`, FK cascade, tenant isolation, sort ordering? → integration test.
5. **Does correctness span the full app surface** — request → router → service → DB → audit log? → acceptance test using `makeTestHttpAppHandler` (see `src/effect/http/app.integration.spec.ts`).

Default to the lowest level that catches the bug. Add a higher-level test only when a lower-level test cannot.

---

## 3. Commands

```bash
pnpm test                  # unit + effect + property specs
pnpm test:watch            # vitest in watch mode (same scope as pnpm test)
pnpm test:cov              # coverage report (v8)
pnpm test:integration      # integration specs; requires Postgres on :5432
pnpm test:mutation:pure    # Stryker mutation testing on files listed in stryker.config.mjs
pnpm test:duplicates       # jscpd: warns when *.spec.ts files diverge from copy-paste
pnpm type-check            # tsc --noEmit
```

Integration tests require a Postgres instance reachable at the connection params from `src/config/db-connection.utils.ts`. Locally: `docker compose up -d postgres` (or equivalent). The harness creates `stocket_inventory_test`, applies committed migrations once per run, and `TRUNCATE ... CASCADE`s before each test.

---

## 4. Unit tests (`*.spec.ts`)

### Service unit tests — the canonical shape

```ts
import { type Mock } from 'vitest';
import { Effect, Layer } from 'effect';
import { MyRepository } from './repository';
import { MyService } from './service';

// 1. Entity / DTO builders with overridable defaults.
const makeEntity = (overrides: Record<string, any> = {}) => ({
  id: 'entity-1',
  tenant_id: '00000000-0000-4000-8000-000000000001',
  // ... every required column with a stable default ...
  ...overrides,
});

// 2. Repository mock factory. Every method returns an Effect, so callers
//    don't need to think about Promise vs Effect at the call site.
const makeMockRepository = (
  overrides: Partial<Record<keyof MyRepository, Mock>> = {},
) => ({
  findById: vi.fn().mockReturnValue(Effect.succeed(makeEntity())),
  create: vi.fn().mockReturnValue(Effect.succeed(makeEntity({ id: 'new' }))),
  // ... one mock per real method, defaulting to a sensible success ...
  ...overrides,
});

// 3. Service builder: wires the service against the mock layers.
const buildService = (repository = makeMockRepository()) =>
  Effect.runPromise(
    MyService.pipe(
      Effect.provide(
        MyService.DefaultWithoutDependencies.pipe(
          Layer.provide(Layer.succeed(MyRepository, repository as any)),
        ),
      ),
    ),
  );

const run = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromise(e);
const fail = <A, E>(e: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(e));

describe('MyService', () => {
  it('does the happy path', async () => {
    const repository = makeMockRepository();
    const svc = await buildService(repository);

    const result = await run(svc.findOne('entity-1'));

    expect(repository.findById).toHaveBeenCalledWith('entity-1');
    expect(result).toMatchObject({ id: 'entity-1' });
  });

  it('maps a domain error', async () => {
    const repository = makeMockRepository({
      findById: vi.fn().mockReturnValue(Effect.succeed(null)),
    });
    const svc = await buildService(repository);

    const error = await fail(svc.findOne('missing'));

    expect(error).toMatchObject({ _tag: 'MyNotFound' });
  });
});
```

**Rules of thumb**:

- One **entity builder** per shape; pass overrides for the fields the test cares about. Don't inline 20-field objects per test.
- One **mock-repository factory** per repository, with `overrides` so individual tests can swap a method.
- Use `await fail(...)` (= `Effect.flip`) for failure-path assertions; never `try { await run(...) } catch`. Effect's error channel is typed; capture it.
- If your unit test imports `DrizzleDatabase` because the service yields it for transactions, provide a typed-but-unused stub: `Layer.succeed(DrizzleDatabase, {} as never)`. Add a comment naming **why** the stub is safe (the unit path short-circuits before any query runs). See `modules/fulfillment/service.spec.ts` for the pattern.

### Router unit tests

The router boundary is `request → guard → decode → service → respond`. Mock the service tag so the test focuses on that pipeline. Canonical template: `modules/inventory/router.spec.ts`.

Key pieces:

```ts
// Swap the real service tag for an empty one so we can plug in mocks.
vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');
  return {
    MyService: Context.GenericTag('@stocket/test/MyService'),
    myLayer: Layer.empty,
  };
});

// `requireSession` is the only piece of session.ts the router hits.
const mockRequireSession = vi.fn();
vi.mock('../../platform/session', async () => {
  const { Effect } = await vi.importActual<typeof import('effect')>('effect');
  return {
    requireSession: Effect.suspend(() => mockRequireSession()),
    getOptionalSession: Effect.succeed(null),
  };
});
```

For routes with meaningful domain behavior, consider covering these cases:

1. **Happy path** — 200/201 with the expected body.
2. **Domain error mapping** — service yields `Effect.fail(new MyNotFound(...))`, response is 404.
3. **Permission denied** — `permissions: {}` (no `Resource.X: [...]`), response is 403, and assert the service method is `not.toHaveBeenCalled()`.
4. **Schema rejection** — invalid body, response is 400 (don't reach the service).

The permission-denied test is often the load-bearing one. If a developer forgets `requirePermission(...)`, this catches it.

### Plain utility unit tests

If the file under test is pure TS with no Effect / no DB, just import and call it. No harness needed. Example: anything in `src/effect/platform/bulk-operation.utils.ts`.

---

## 5. Effect-native unit tests (`*.effect.spec.ts`)

Preferred for **new** services with simple wiring. The test body itself is an Effect, so failures in the error channel fail the test — no `runPromise` escape hatch, no `await fail(...)` helper.

Canonical reference: `modules/branding/service.effect.spec.ts`. Skeleton:

```ts
import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  makeMockServiceLayer,
  makeServiceTestHarness,
} from '../../testing/test-harness';
import { MyRepository } from './repository';
import { MyService } from './service';

const makeDefaultRepo = () =>
  ({
    findById: () => Effect.succeed(null),
  }) satisfies Partial<MyRepository>;

const makeRepo = makeMockServiceLayer(MyRepository, makeDefaultRepo);

const harness = makeServiceTestHarness(
  MyService,
  MyService.DefaultWithoutDependencies,
);

describe('MyService', () => {
  it.effect('does the thing', () =>
    harness.effect(makeRepo().layer, (svc) =>
      Effect.gen(function* () {
        const result = yield* svc.doTheThing('abc');
        expect(result).toBeDefined();
      }),
    ),
  );
});
```

`makeMockServiceLayer` builds on `makeTestLayer`, so any method you don't list explicitly **dies loudly** when called, with a message naming the missing method. It also returns the mock service object next to the layer so assertions can inspect `vi.fn` calls without rebuilding local run helpers.

Use `layer(...)` / `it.layer(...)` from `@effect/vitest` for layer-backed fixtures that are intentionally shared across a test group. The service harness is for mutable mocks that should be rebuilt and released around one test body; use its `layer(...)` method with the native API when sharing is intentional.

Don't rewrite working `*.spec.ts` files just to migrate to `it.effect`. Use it for new code.

---

## 6. Property tests (`*.property.spec.ts`)

Use [`fast-check`](https://github.com/dubzzz/fast-check) when the function's contract is best expressed as an invariant. Templates:

- `src/effect/platform/messages.property.spec.ts` — locale resolution
- `src/effect/platform/bulk-operation.utils.property.spec.ts` — bulk builder
- `src/auth-cookie-domain.property.spec.ts` — cookie-domain derivation

Shape:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { myPureFn } from './my-pure-fn';

describe('myPureFn properties', () => {
  it('always returns a value the predicate accepts', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer(), (s, n) => {
        const result = myPureFn(s, n);
        expect(predicate(result)).toBe(true);
      }),
    );
  });
});
```

Tips:

- Use **named arbitraries** for non-trivial inputs (`labelArbitrary`, `domainArbitrary` in `auth-cookie-domain.property.spec.ts`) so the property reads as the invariant, not as scaffolding.
- Pair property tests with a couple of hand-written negative cases — fast-check is great at finding edge cases, but a known-failing input documents intent.
- Property tests are also Stryker's primary defense: they generate enough input variety that mutations to the function under test are likely to break at least one example.

---

## 7. Integration tests (`*.integration.spec.ts`)

Run against real Postgres. The global setup applies committed migrations once; each test gets a truncated DB.

### The basic shape

```ts
import { Effect, Layer } from 'effect';
import type { DrizzleDb } from '../../platform/drizzle';
import {
  getTestDb,
  makeTestDrizzleLayer,
  runTest,
  runTestFailure,
  seedCategory,
  seedProduct,
  TEST_USER_ID,
  withTestDb,
} from '../../testing/test-harness';
import { MyService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<MyService>;

withTestDb(); // registers beforeAll/afterAll/beforeEach hooks
beforeAll(() => {
  db = getTestDb();
  TestLayer = MyService.Default.pipe(Layer.provide(makeTestDrizzleLayer()));
});

describe('MyService integration', () => {
  it('creates a row', async () => {
    const category = await seedCategory(db);
    const product = await seedProduct(db, { category_id: category.id });

    const result = await runTest(
      Effect.flatMap(MyService, (s) => s.findById(product.id)),
      TestLayer,
    );

    expect(result.id).toBe(product.id);
  });
});
```

**Rules**:

- Always call `withTestDb()` at module scope. It registers the lifecycle hooks idempotently.
- Always seed through the `seed*` helpers re-exported from `test-harness`, not raw `INSERT`s. They keep defaults consistent across tests and survive schema changes.
- Use `runTest` / `runTestFailure` over `Effect.runPromise`. They thread the test layer for you.
- Don't share state across tests. The truncate-between-tests semantics mean every test starts from empty.

### Multi-tenancy assertions

Whenever a query is supposed to be scoped to a tenant, write a test that seeds rows under a **different** `tenant_id` and asserts they don't leak. Pattern: `modules/inventory/service.integration.spec.ts → describe('findSummary') → 'excludes inventory rows from other tenants'`.

```ts
const otherTenantId = randomUUID();
await seedProduct(db, { tenant_id: otherTenantId, ... });
await seedInventory(db, { tenant_id: otherTenantId, ... });

const result = await runTest(/* ... */, TestLayer);
expect(result.low_stock_count).toBe(1);  // not 2
```

### Filter-matrix tests (pagination / search)

When testing a `findAllPaginated` style method, build a deliberate **target row + decoys** where each decoy fails exactly one filter. Then assert `meta.total === 1` and `data[0].id === target.id`. This catches join-duplicates-count bugs (the classic `LEFT JOIN items` blowup). Templates:

- `modules/products/find-all-paginated.integration.spec.ts`
- `modules/orders/find-all-paginated.integration.spec.ts`

### Transactional / atomicity tests

When a service method must be atomic (all-or-nothing across multiple writes), write an integration test that:

1. Seeds the precondition.
2. Triggers a mid-flow failure.
3. Asserts that **every** intermediate write was rolled back — not just the one that failed.

Reference: `modules/fulfillment/service.atomicity.integration.spec.ts`. To force a failure mid-transaction, the cleanest trick is feeding invalid data that one of the later inserts will reject (e.g., passing a non-UUID `actorId` so the `stock_movements` insert blows up after inventory has been decremented).

The test must inspect raw rows after the failure (`db.select().from(table)`) — not the service's own getters, which might paper over partial state.

### Acceptance tests (full HTTP app)

For high-value paths that span router → service → DB → audit, write an acceptance test using `makeTestHttpAppHandler` from `src/effect/testing/app-harness.ts`. Template: `src/effect/http/app.integration.spec.ts`.

```ts
const { handler, dispose } = makeTestHttpAppHandler({
  session: makeSession(TEST_USER_ID),
});
try {
  const response = await handler(
    new Request('http://localhost/api/v1/inventory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ /* ... */ }),
    }),
  );
  expect(response.status).toBe(201);

  // Direct DB assertions on the row that was created.
  const rows = await db.select().from(inventory).where(eq(inventory.id, body.id));
  expect(rows[0]).toMatchObject({ tenant_id: DEFAULT_TENANT_ID, ... });

  // Audit logs are fire-and-forget — poll instead of asserting immediately.
  const auditLog = await waitForAuditLog(body.id);
  expect(auditLog).toMatchObject({ action: AuditAction.CREATE, ... });
} finally {
  await dispose();
}
```

Reserve acceptance tests for the **golden paths**: create, list, delete, plus one denied/invalid case per resource. They're slow and have wide blast radius — every middleware change re-exercises them.

### Async-side-effect assertions (audit logs, etc.)

`AuditLogWriter` is fire-and-forget per `CLAUDE.md`. Don't assert audit rows synchronously; poll. The `waitForAuditLog` helper in `http/app.integration.spec.ts` is the reference:

```ts
async function waitForAuditLog(entityId: string) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const row = await findAuditLog(entityId);
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for audit log for ${entityId}`);
}
```

500 ms ceiling, 20 ms steps. Don't bump the ceiling without investigating — a slow audit write is its own bug.

---

## 8. Mutation testing (`pnpm test:mutation:pure`)

Stryker mutates the source files listed in `stryker.config.mjs` (currently `auth-cookie-domain.ts`, `bulk-operation.utils.ts`, `messages.ts`) and re-runs the test suite. Each surviving mutant is a hint that the tests don't actually pin down the behavior.

Mutation testing is slower than normal Vitest runs. Use it as a targeted confidence check, not as part of the default edit-test loop.

**When to add a file to `mutate:`**:

- It's a **pure utility** (no I/O, no Effect dependencies) that the system relies on.
- It has property tests or extensive unit tests that should, in theory, catch every meaningful change.

**Don't** mutate:

- Service or repository files. Mutation testing them is slow and produces false positives from layer wiring.
- Files where the contract is "delegate to another module" — there's nothing semantically interesting to mutate.

Read the Stryker HTML report (in `reports/mutation/`) to see surviving mutants. Each one is either a real test gap or an "equivalent mutant" (semantically identical) — fix the gap, or document the equivalent.

Mutation testing is **opt-in**: it's not part of `pnpm test` and not (currently) a CI gate. Run it when you ship a new pure utility.

---

## 9. Duplication check (`pnpm test:duplicates`)

`jscpd` flags duplication across `**/*.spec.ts`. The threshold (8%) is intentionally generous — copy-paste is rampant and sometimes appropriate. The check exists to catch **drift**: when 4 nearly-identical tests should have been extracted into a helper or a `it.each(...)` loop.

Run it before merging a PR that adds a lot of similar tests. If the percentage jumps, factor out the duplication into a helper in the same file (or in `src/effect/testing/`).

---

## 10. Common patterns and pitfalls

### Patterns to repeat

- **Stub layers with intentional gaps**. `makeTestLayer` makes missing methods die loudly. Embrace that — when a test calls a method you didn't mock, the error message tells you exactly which one.
- **Builders take partial overrides**. `makeEntity({ tenant_id: 'other' })` reads clearly; spreading an inline 30-field literal does not.
- **Assert at the boundary you're testing**. Service tests assert the returned DTO. Router tests assert the HTTP `Response`. Integration tests assert the DB rows. Don't mix.
- **One arrange-act-assert per `it`**. If you find yourself writing two `expect` blocks separated by a setup, that's two tests.
- **Comment why a stub is safe**, especially for `Layer.succeed(SomeService, {} as never)`. A future contributor will want to know whether the path under test actually reaches the stub.

### Pitfalls

- **Don't mix unit and integration in the same file.** Vitest's two configs use file-suffix matching; an `*.integration.spec.ts` is excluded from `pnpm test`, and a `*.spec.ts` is excluded from `pnpm test:integration`. A "mostly unit" file with one integration test will silently skip that test in CI.
- **Don't `await Effect.runPromise` and expect rejection.** Use `await fail(effect)` (= `Effect.runPromise(Effect.flip(effect))`) or `it.effect` with an `Effect.flip`. Mixing rejected-promise and Effect-failure semantics is a source of brittle tests.
- **Don't seed via raw SQL.** Use the `seed*` helpers. Schema changes break raw `INSERT`s silently — defaults shift, columns get renamed.
- **Don't share `db`, `TestLayer`, or `Pool` instances across describe blocks via globals.** Keep them inside a `beforeAll` that runs after `withTestDb()` has wired the lifecycle.
- **Avoid testing private behavior through `as any`.** Treat it as a design smell; prefer testing through the public surface or refactoring the seam.
- **Don't add `console.log` or `process.exit` for "temporary debugging" and forget to remove it.** Use `Effect.tap((x) => Effect.log(x))` or vitest's `--reporter=verbose`.

---

## 11. Anatomy of a test addition

When you're adding a feature, consider which of these layers would catch the likely regression:

1. **Property test** for a new pure utility with interesting invariants.
2. **Unit test** for service domain logic, especially mapped-error cases.
3. **Router unit test** for a new route's HTTP/permission/schema boundary.
4. **Integration test** for SQL behavior, tenant scoping, sorting/filtering, or transactional invariants.
5. **Acceptance test** for a golden path that should never regress.

You don't need all five every time. Default to the smallest test that catches the bug you're most worried about, then add broader tests only when the narrower seam would miss the risk.
