# Boundary-Typing Remediation — Removing the Laundered Casts

**Status:** proposed; opens the discussion on removing the helpers flagged in
`plans/module-standardization-review.md`.
**Relationship:** the review doc is the diagnosis; this is the execution/removal plan.
Read that first for the *why*; this doc is the *what to change, in what order, and what
needs a human decision before starting*.

**Guiding rule (the whole point):**
> A shared boundary helper must **decode or narrow to a real type**. Centralizing an
> `as`-cast or a `typeof`/record check into a reusable export solves nothing — if the
> helper still returns `x as T`, it has only made the smell importable.

Everything below either makes a helper actually decode, or deletes it and contains the
boundary where it genuinely lives.

## Decisions to resolve before coding (the "start a conv" part)

Two items are judgment calls, not defects. They gate their workstreams; the rest can
proceed without them.

1. **Products ↔ `makeTenantCrud` fit (Workstream E).** Products needs joins on every
   read, so all reads live in `extras` while the factory still emits unused, join-less
   `findById`/`findAllPaginated`. Choose:
   - **(E1) Un-migrate products' reads** — products goes back to `TenantQuery` helpers
     for reads, factory used only for writes (or not at all). Less machinery; accepts
     products isn't plain CRUD.
   - **(E2) Teach the factory to omit reads it can't serve** — add `omitReads` /
     `reads: false` so join-heavy modules opt out and reclaim the canonical method
     names. More work now, but orders has the same shape and would reuse it.

   *Recommendation:* E2 if orders (or any second join-heavy module) is migrating soon;
   E1 if products stays the only one. **Needs a call before starting E.**

2. **`tenant-route` scope (Workstream F).** Adopted in 15/20 routers, so it stays — the
   question is whether to slim its surface (drop `permission` vs `permissions`
   duplication; split the 9-generic all-in-one into a common `tenantRoute` + explicit
   composition for audited/empty/multipart routes) or accept the complexity as the
   price of one entry point. **Needs a "yes the generics earn their keep" or a slimming
   mandate before starting F.**

Workstreams A–D and G below need no decision and can start immediately.

## Workstream A — `executeRows` actually decodes (or disappears)

**Problem:** `execute-rows.ts` ends in `return rows as TRow[]`; all 8 call sites pass a
phantom type arg that asserts nothing.

**Change 1 — helper takes a row Schema.**
```ts
// platform/db/execute-rows.ts
import { Schema } from 'effect';
// keep rowsFromExecuteResult as the shape-normalizer (Array vs {rows}) — that stays.
export const executeRows = async <A>(
  db: Pick<DrizzleDb, 'execute'>,
  query: SQL,
  rowSchema: Schema.Schema<A>,
): Promise<A[]> =>
  Schema.decodeUnknownSync(Schema.Array(rowSchema))(
    rowsFromExecuteResult<unknown>(await db.execute(query)),
  );
```

**Change 2 — decode at each site (or drop the helper for scalars):**
- `orders/repository.ts:293` `getNextOrderNumberSequence` — `nextval(...)::bigint`
  returns a numeric-as-string. Decode `Schema.Struct({ value: Schema.NumberFromString })`
  and drop the `Number(...)` coercion, or inline a one-field decode since it's a single
  scalar. Either way `<{ value: unknown }>` goes away.
- `users/repository.ts:186` count — `Schema.Struct({ total: Schema.Number })`.
- `users/repository.ts:192,213` `TenantUserRow` — define a `TenantUserRowSchema`
  (`Schema.Struct` matching the aliased columns: `id, name, email, image, banned,
  banReason, banExpires, createdAt`) and reuse it for both queries. This also turns the
  `TenantUserRow` type into a decoded contract instead of a hand-written interface.
- `superadmin/repository.ts:80,261,356` — one `Schema.Struct` per query shape
  (`SuperAdminUserRow`, the session-column check, the `{ exists: number }` probe).
- `platform/db/dev-tenant-domain-cleanup.ts:35` — small struct.

**Consider eliminating the boundary entirely** where the raw SQL is only there to dodge
Drizzle: the `count(*)` and `EXISTS` probes can be expressed through Drizzle's typed
`select({ count: sql<number>\`...\` })` builder (as the tenant-crud factory already does),
removing both the cast and the decode. Do this for the trivial ones; keep `executeRows`
only for the genuinely complex hand-written SQL (the users search join, superadmin).

**Verify:** `pnpm test` for the decode unit specs (extend `execute-rows.spec.ts` with a
malformed-row case that must now throw, not silently pass); `pnpm test:integration` for
orders/users/superadmin repositories.

## Workstream B — dismantle `platform/effect/unknown.ts`

**Problem:** it exports a general `isUnknownRecord` (6+ importers) — a standing invitation
to re-validate typed values.

**Steps:**
1. **`isUnknownRecord`** — remove the export. Its only legitimate consumer is `pg-errors`
   (Workstream C, which inlines its own). After C, no module should import it. Grep must
   return zero non-boundary hits.
2. **`errorFromUnknown`** — keep; rename to `toError` and move next to the try/promise
   wrappers in `platform/effect/`. It's a valid interop shim for throwing into non-Effect
   APIs (`photo-importer.ts` uses it for exactly that).
3. **`messageFromUnknown`** — keep exactly one copy, living in
   `platform/http/errors.ts` (the HTTP layer genuinely formats unknown failures for the
   response body). Its current module callers:
   - `notifications/service.ts:45`, `superadmin/service.ts:109`,
     `products/import/utils.ts:858`, `llm-proposer.ts:645` — audit each: if a typed error
     is already in hand, `catchTag`/`mapError` to a message and delete the call; only the
     genuine last-resort formatters import the shared one.
4. Delete `unknown.ts` once empty; move `unknown.spec.ts` cases to wherever `toError` /
   `messageFromUnknown` land.

**Verify:** typecheck (the removed export surfaces every stray importer); `pnpm test`.

## Workstream C — self-contain `pg-errors.ts`

**Problem:** recursive cause-walk with a `seen` cycle-guard and the shared record guard,
for a driver error that carries `code`/`constraint` at top level (Drizzle wraps one
`.cause` deep).

**Change:**
```ts
// platform/db/pg-errors.ts — no import from ../effect/unknown
const PG_UNIQUE_VIOLATION = '23505';
const asPgError = (v: unknown): { code?: unknown; constraint?: unknown; cause?: unknown } | null =>
  v !== null && typeof v === 'object' ? v : null;

export const pgUniqueViolationConstraintName = (cause: unknown): string | null => {
  for (const level of [asPgError(cause), asPgError(asPgError(cause)?.cause)]) {
    if (level?.code === PG_UNIQUE_VIOLATION && typeof level.constraint === 'string') {
      return level.constraint;
    }
  }
  return null;
};
```
Local narrowing, at most one `.cause` hop, no shared guard, no `Set` (driver error chains
don't cycle). If a real case needs deeper walking, add depth explicitly with evidence.

**Verify:** `pg-errors.spec.ts` — keep the top-level and one-level-nested cases; drop the
cycle-guard test.

## Workstream D — fulfillment error round-trip

**Problem (subtler than the review implied):** `isFulfillmentError` (string-`Set` +
record check) exists because a typed `FulfillmentError` is run through
`runEffectAsPromise` inside `db.transaction`'s async callback (`service.ts:171`), so at
the outer `tryPromise` catch (`:173`) it arrives as a caught JS `unknown`, not an Effect
failure. `catchTags` can't see it there — it already left the typed channel.

**Two tiers:**
- **D1 (minimal, low-risk):** the module already defines a `FulfillmentTransactionDefect`
  wrapper. Have `runEffectAsPromise`/the tx boundary wrap the *typed failure* onto that
  class as a field (`.failure: FulfillmentError`), then the catch does
  `cause instanceof FulfillmentTransactionDefect ? cause.failure : wrapInfrastructureError(...)`.
  One `instanceof` on our own class, no drift-prone tag Set, no `isUnknownRecord`. Delete
  `fulfillmentErrorTags` and `isFulfillmentError`.
- **D2 (proper, larger):** replace the promise round-trip with an Effect-native
  transaction so failures never leave the typed channel and the whole thing composes with
  `catchTags` like every other service. Bigger change to the tx wrapper; do only if D1's
  `instanceof` still bothers us or the tx wrapper is being reworked anyway.

*Recommendation:* D1 now; note D2 as the eventual target when the transaction wrapper is
next touched.

**Note:** inventory's `instanceof` branching (flagged in the original audit) was **already
migrated to `catchTag`** in this implementation (`inventory/service.ts:107,115`), as was
photos. Fulfillment is the last holdout. Don't re-open the others.

**Verify:** `pnpm test:integration` fulfillment pick/confirm paths, including a forced
typed failure inside the transaction (must surface as the typed error, not an infra 500).

## Workstream E — products factory fit (gated on Decision 1)

Per the chosen option:
- **E1:** revert products' reads to `TenantQuery` helpers; keep the `*WithRelations`
  methods as the only readers (drop the `WithRelations` suffix since there's no longer a
  generated twin to disambiguate from). Factory retained only for the write set if it
  still pays off, else fully reverted for products.
- **E2:** add `omitReads`/`reads: false` to `makeTenantCrud`; set it for products; rename
  `*WithRelations` back to canonical `findById`/`findAllPaginated`/etc. Update
  `tenant-crud.ts` types + `tenant-crud.integration.spec.ts` to cover the omit path.

Either way the end state: **no join-less generated reader is reachable on
`ProductsRepository`**, so `repository.findById(id)` can't silently return a
relation-less product.

**Verify:** products `service.integration.spec.ts` + `find-all-paginated.integration.spec.ts`
green; grep confirms no caller hits a join-less reader.

## Workstream F — tenant-route slimming (gated on Decision 2)

If slimming is mandated:
- Collapse `permission` + `permissions` → `permissions` only.
- Extract the common case into a lean `tenantRoute` (permissions + decode + handler +
  JSON); route audited-mutation / empty-response / multipart cases through the existing
  `respondAuditedMutation` / `respondEmpty` helpers explicitly rather than as options on
  one 9-generic signature.
- Remove or isolate the `as unknown as` at `tenant-route.ts:62` (the path-params encoded
  cast) into the single `pathParams` helper with a comment on why the cast is
  unavoidable at that `schemaPathParams` boundary.
- Migrate routers incrementally; no behavior change per route (assert via existing
  `router.spec.ts` suites).

If not mandated: document in `tenant-route.ts` why the generics and dual options exist, so
it's a decision on record, and close F.

## Workstream G — guardrail wording (land with A–D)

Add to `backend/CLAUDE.md` "Types at the Boundary" (one line):
> A shared boundary helper must decode or narrow to a real type. Do not centralize an
> `as`-cast or a `typeof`/record check into a reusable export — a helper that returns
> `x as T` has not solved anything.

Point `.claude/agents/effect-reviewer.md` at three concrete smells to flag on future PRs:
`executeRows`/`db.execute` calls without a row Schema; exported `is*Record` guards; and
`_tag`-string `Set`s used for error detection.

## Sequencing & issue breakdown

Each workstream is one issue on the **Stocket Improvements Tracker** (per repo
convention), sized to a single reviewable PR:

1. **A + C + B together** — one theme ("stop laundering casts in DB/error boundaries"),
   B depends on C removing the last `isUnknownRecord` consumer. Small, high signal.
2. **G** — lands in the same PR as (1) so the next agent pass can't regrow it.
3. **D1** — isolated, mechanical.
4. **E** — after Decision 1; touches products behavior, integration tests are the gate.
5. **F** — after Decision 2; largest blast radius, do last or defer.

**Blocked-on-input:** Decisions 1 and 2 above. Everything else is ready to start.
