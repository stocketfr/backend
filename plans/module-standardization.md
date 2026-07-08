# Module Standardization Plan

**Status:** proposed
**Scope:** `backend/src/effect/modules/*` and the platform helpers under `backend/src/effect/platform/*`
**Origin:** duplication audit of `products`, `orders`, `inventory`, plus grep sweeps across all 20 modules (2026-07-07)

## 1. The problem

Every feature module re-implements the same cross-cutting concerns: tenant scoping,
not-found handling, write-then-reload, bulk operations, tracing, infrastructure-error
wrapping, and router ceremony. The platform layer already has abstractions for about
half of these (`TenantQuery`, `makeTenantCrud`, `makeServiceTracer`, `fromNullOr` /
`makeGetOrFail`, `makeTryAsync`), but adoption stalled partway, so the tree contains
**three generations** of the same code:

| Generation | Tenant scoping | Example modules |
|---|---|---|
| 1 — hand-rolled | `eq(table.tenant_id, tenantId)` built inline (~44 predicates) | orders, inventory, areas, notifications, photos |
| 2 — helper-based | `TenantQuery.whereTenant*` | products, stock-movements, audit-logs, products/import |
| 3 — factory-based | `makeTenantCrud` | suppliers, categories, clients, locations |

New modules get written by copying the nearest existing module, which is as likely to
be generation 1 as generation 3, so the drift compounds. Meanwhile the duplicated code
is not just verbose — it is where the audit found its actual bugs (SKU-race 500s,
orphan order rows, wrong ids reported as succeeded in bulk results).

### Duplication inventory

Counts are from grep sweeps; file references are representative, not exhaustive.

1. **Cross-module existence checks** (~11 copies). The
   `service.existsById(id) → filterOrFail(Boolean, new XNotFound(...))` wrapper is
   hand-rolled in products (×2), inventory (×4 — with *two different error classes*
   for "product not found": `InvalidInventoryProduct` vs `InventoryProductNotFound`),
   stock-movements (×5), and orders (×2, in `if (!exists) fail` form). Orders reuses
   products' `ProductNotFound` with a different messageKey; every other consumer
   invents its own foreign-entity error.

2. **Write → reload → DTO** (every mutating method in every service). The standard
   mutation is `getXOrFail → repo.update → getXOrFail → toXResponseDto`: three queries
   per update. Repositories already do `.returning()` and discard the rows. 14 of 20
   services match the pattern.

3. **Check-then-act races and non-transactional multi-writes.**
   - products: `ensureSkuAvailable` then insert — the `products_tenant_sku_unique`
     index is not partial, so a soft-deleted SKU or a concurrent create surfaces as a
     500 `ProductsInfrastructureError` instead of `SkuAlreadyExists`.
   - inventory: `findByProductAndLocation` then create — same shape.
   - orders: `create` inserts the order row, then inserts items with no transaction —
     a failure in `createMany` leaves a committed orphan order.
   - orders: draft-status check then delete — status can change in between.
   `db.transaction` is only used by fulfillment, users, and superadmin.

4. **Bulk-result bookkeeping** (products only today, but the module set is growing).
   `bulkUpdateStatus` / `bulkDelete` / `bulkRestore` are one pipeline
   (findByIds → partition → act → build) copy-pasted three times, and all three report
   `succeeded: ids.slice(0, affectedCount)` — an arbitrary prefix when a row vanishes
   mid-operation, even though the repository has the real ids from `.returning()`.

5. **Verbatim service/repository boilerplate.**
   - `if (Object.keys(dto).length === 0) return ...` — 6 modules, character-identical.
   - `const { tenant_id: _tenantId, ...updateData } = data` + `updated_at: new Date()`
     stamp — 7 copies across 5 repositories (`makeTenantCrud` already does both).
   - Manual "copy each defined field" patch building — 5 `if`s in orders' update,
     7 in inventory's.
   - The `makeTryAsync` + `XInfrastructureError` + `x.repositoryFailed` preamble —
     17 files, 18 `InternalError` subclasses.

6. **Partial tracer adoption.** 12 services use `makeServiceTracer`; products,
   inventory, and stock-movements — the highest-write-volume modules — hand-roll
   `Effect.withSpan` and therefore lose requestId/tenantId annotation and
   success/not_found/validation_error outcome classification. `TraceModule` in
   `platform/observability/service-tracer.ts` is missing those module names.

7. **Router route ceremony** (~90 routes across 14 routers). Every route is the same
   scaffold: `requirePermission → schema parse (body / searchParams / pathParams) →
   getOptionalSession|requireSession → service call → optional AuditLogWriter block →
   respondJson(Ok)`. The audit block is copy-pasted per mutating route; bulk routes log
   only `result.succeeded[0]` as the entityId. The `searchParams` cast workaround for
   `schemaSearchParams` lives privately in `products/router.ts` instead of
   `platform/http`.

8. **Hand-rolled runtime validation where Effect Schema already exists.**
   - `products/router.ts:60–147`: ~90 lines of `isRecord` / `hasOptionalString` /
     `hasOptionalMappingArray` guard functions plus manual `JSON.parse` to validate
     the import plan — a re-implementation of `Schema.parseJson(<PlanSchema>)` whose
     hand-maintained predicate can silently drift from the `ProductImportPlan` type.
   - `products/import/llm-proposer.ts:146–260+`: ~150 lines of `asString` /
     `asPositiveInteger` / `clampConfidence` / per-field literal checks to leniently
     decode LLM JSON output. Lenient decode-with-fallbacks is expressible as a Schema
     (optional fields with defaults + transforms) in one declaration.
   - Three separate local `isRecord` definitions exist in the products module alone
     (router, service cause-walker, llm-proposer).

9. **Casts papering over untyped boundaries.**
   - `db.execute` raw results: the `(result as unknown as { rows: ... }).rows ??
     (result as unknown as ...[])` double-cast dance appears in
     `orders/repository.ts:229` and three times in `users/repository.ts`. Four copies
     of uncertainty about the driver's return shape.
   - `orders/service.ts:205`: `updateData[timestampField] = new Date() as never` —
     the order-state map's typing forces a cast on every status write.
   - The `schemaSearchParams` cast (item 7) is the same disease at the HTTP boundary.

10. **`instanceof` error branching instead of tagged-error handling.**
    `inventory/service.ts:98–111` branches on `error instanceof AreaNotFound` /
    `AreasInfrastructureError` inside `mapError`; `fulfillment/service.ts:26–30`
    chains five `instanceof` checks into a domain-cause predicate;
    `photos/service.ts:204` likewise. Effect's tagged errors exist precisely so this
    is `Effect.catchTag`/`catchTags` with exhaustiveness from the type system.

11. **Scattered `process.env` reads with divergent predicates.** `NODE_ENV` is
    consulted in 8+ production files with three different notions of "production"
    (`=== 'production'` in security-headers/e2e/tenant-queries;
    `!== 'production' && !== 'staging'` duplicated in `auth.ts` and
    `platform/tenancy/host.ts`; `isProviderRuntime` in email). `LOG_LEVEL` /
    `LOG_SQL` / `RESERVED_TENANT_SLUGS` / `E2E_SEED_SECRET` are parsed inline at
    their use sites. There is no single typed config surface, so every new
    env-dependent behavior adds another ad-hoc check — and implementation agents
    imitate the pattern, multiplying it.

12. **Per-module message-catalog burden.** Every module hand-registers its standard
   keys (`x.notFound`, `x.repositoryFailed`, …) in three locale catalogs
   (`platform/catalogs/{en,fr,de}.ts`); `*.notFound` alone appears for 11 modules.
   This is partly by design (the structured-logging invariant requires hand-typed
   `MessageKey`s), but there is no checklist that keeps the three files in sync
   beyond CLAUDE.md prose.

### What it costs to add a module today

A new CRUD module currently touches: repository (with hand-chosen generation),
service (get-or-fail, ensure-exists wrappers, write-reload shape, spans), errors file
(NotFound/BadRequest/Infrastructure triad), router (per-route ceremony + audit
blocks), `TraceModule` union (if the author knows it exists), three locale catalogs,
`LogProperties` (if new placeholders), shared types, and the three RBAC enforcement
layers. Nothing enforces consistency across those touchpoints — the copied-from module
does.

## 2. Goal and design principles

**Goal:** one canonical way to express each cross-cutting concern, with explicit,
typed extension points — so a future module that needs to *adjust* a standard element
(soft delete, custom joins, extra bulk ops, different audit granularity) extends the
kit instead of forking it.

Principles:

- **Config over copy.** Standard behavior comes from a factory; deviation is a config
  option or an `extras` callback, never a re-implementation. `makeTenantCrud`'s
  `extras` + `TenantCrudTools` (scoped `where` builders + module-scoped `tryAsync`)
  is the model: bespoke methods ride the same tenant fence as generated ones, and
  there is no way to obtain an unscoped WHERE from the tools.
- **Guardrails stay.** Hand-typed `MessageKey`s per module (structured-logging
  invariant), `onError` mapping in module code, `DrizzleDatabase`/`BetterAuth` never
  in `dependencies:`, no `Effect.fn` migration of traced methods (per CLAUDE.md).
- **Closed unions are checklists.** `TraceModule` staying a literal union is a
  feature: adding a module fails the type-check until the author registers it. Same
  spirit for locale catalogs — enforce with a test, not convention (see §3.6).
- **The database is the source of truth for invariants.** Uniqueness and state
  transitions are enforced by constraints/atomic SQL; pre-checks exist only to give
  nicer errors, and constraint violations must map to the same domain errors.
- **Migrate by generation, verify by behavior.** Each phase is a small PR gated on
  the module's existing integration tests; no behavior changes ride along with
  mechanical migrations.

## 3. The design: a module kit

### 3.1 Repository layer — finish `makeTenantCrud`

Extend `platform/db/tenant-crud.ts` so the factory covers what kept products (and
future soft-delete modules) out:

- **Soft delete as config:**
  ```ts
  makeTenantCrud(products, {
    entity: 'product',
    onError: ...,
    softDelete: { deletedAt: products.deleted_at, deletedBy: products.deleted_by },
    list: { filters, orderBy },
  })
  ```
  When present: generated reads add `isNull(deleted_at)` (with an `includeDeleted`
  option per call), and the factory emits `softDelete`, `softDeleteMany`, `restore`,
  `restoreMany`, `findDeletedByIds`, `hardDelete`, `hardDeleteMany`. Absent: `delete`
  stays the hard idempotent delete it is today. Future modules flip one config key.
- **Bulk primitives:** `findByIds`, `updateMany` — all `*Many` writes return the
  **ids** from `.returning({ id })`, not a count, so services can report exact
  outcomes (kills the `slice(0, affectedCount)` bug class at the root).
- **Unique-violation mapping:** an optional `uniqueViolations: { [constraintName]:
  (cause) => E2 }` config consulted inside `create`/`update` before falling through
  to `onError`. Precedent: the pg `23505` handling in `superadmin/service.ts`.
  Products maps `products_tenant_sku_unique → SkuAlreadyExists`; inventory maps its
  product/location constraint → `InventoryAlreadyExists`. Pre-checks become optional
  UX sugar instead of load-bearing.
- **Joined reads stay in `extras`.** Join shapes (products ↔ category/supplier,
  orders ↔ client/items) are genuinely per-module; they use `scopedWhere*` from
  `TenantCrudTools` so they cannot drop the tenant predicate. Do not try to
  generalize joins into the factory.
- **Transaction tool:** add `withTransaction` to `TenantCrudTools` (thin wrapper over
  `db.transaction` + module `tryAsync`) so multi-write extras (orders create/delete)
  are atomic without each module re-deriving the wrapper fulfillment already built.

### 3.2 Service layer — small shared helpers, adopted everywhere

- **`ensureExistsById` on every service** that others reference (products,
  categories, suppliers, clients, locations, orders):
  `ensureExistsById(id): Effect<void, XNotFound | XInfrastructureError | TenantNotResolved>`
  defined once next to `existsById`, using the module's own canonical NotFound error.
  Consumers stop constructing foreign error classes; inventory's duplicate
  product-not-found errors collapse to one. Add batch form `ensureExistByIds(ids)`
  backed by one `findByIds` query for the N+1 loops (orders create, products
  bulkCreate).
- **Reload-after-write helper** in `platform/effect/from-null-or.ts`:
  `reloadOrFail(find, id, onMissing)` (or simply consistent use of the existing
  `makeGetOrFail`), plus a convention: repository `update` returns the row (the
  factory's already does) and services only re-query when the response needs joins.
  Target shape: one read + one write per mutation instead of two reads + one write.
- **Bulk pipeline helper** (in `@stocket/types/common` beside `partitionByExistence`,
  or `platform/effect`): `runBulkByIds({ ids, find, act, entityLabel })` returning the
  built bulk result from the ids `act` actually returned. Products' three bulk methods
  become three one-liner configs; the next module with bulk endpoints reuses it.
- **Patch-building convention:** replace the 5–7 `if (dto.x !== undefined)` blocks
  with a shared `pickDefined(dto, keys)` helper; keep the empty-patch early return
  inside the helper so the 6 verbatim copies disappear.

### 3.3 Observability — complete the tracer migration

Add `'products' | 'inventory' | 'stock-movements'` (and any other missing service
modules) to `TraceModule`; replace hand-rolled `Effect.withSpan` with
`trace.span(...)` / `trace.traced(...)`. Mechanical, no behavior change beyond
richer span attributes. Future modules hit the closed union and register themselves.

### 3.4 Router layer — one route builder

Add a `platform/http` route helper capturing the universal scaffold:

```ts
tenantRoute({
  permission: [Resource.PRODUCTS, Permission.WRITE],   // or a composite guard effect
  body: CreateProductRequestSchema,                    // and/or query / pathParams
  session: 'optional',                                 // 'optional' | 'required' | 'none'
  audit: (result) => ({ action: AuditAction.CREATE,    // omit for reads
                        entityType: AuditEntityType.PRODUCT,
                        entityId: result.id }),
  status: 201,
  handler: ({ dto, userId }) => ProductsService.pipe(Effect.flatMap(s => s.create(dto, userId))),
})
```

- Composite guards (like products' import access = 3 permissions + a feature flag)
  are passed as a prebuilt effect — the helper does not need to model them.
- Audit callback receives the result, so bulk routes can emit one entry per
  succeeded id instead of logging only `succeeded[0]` (fire-and-forget invariant
  unchanged).
- Move the `searchParams` cast workaround from `products/router.ts` into the helper's
  home so the cast exists in exactly one place.
- Routes that don't fit (multipart import upload, streaming) keep using raw
  `HttpRouter` — the helper is a default, not a cage.

### 3.5 Idempotency and consistency conventions

Codify in `TESTING.md`/module docs (and enforce via the factory where possible):

- Uniqueness is a DB constraint; services map violations to domain errors
  (§3.1). Pre-checks are optional and never the only guard.
- Multi-write operations run in `withTransaction` (orders create/delete first).
- Repeat delete → 404, repeat restore → domain error (current REST semantics stand);
  repository-level deletes stay idempotent no-ops as documented on the factory.
- State transitions that gate writes (orders draft-only delete) move the check into
  the WHERE clause of the write (`status = 'DRAFT'`) and treat 0 affected rows as the
  domain error — same pattern as `incrementPicked`'s quantity guard.

### 3.6 Message catalogs — enforce sync mechanically

Keep hand-typed keys (guardrail), but add a unit test that asserts en/fr/de catalogs
have identical key sets, and that every `messageKey` literal in `modules/**` exists in
the catalogs. Turns the "update every locale catalog" prose rule into a failing test.

### 3.7 Types at the boundary — decode once, then trust

The rule that eliminates inventory items 8–11: **external input is decoded exactly
once, at the boundary, with Effect Schema; past that point values are typed and no
defensive re-checking is allowed.** Concretely:

- **HTTP bodies/params/uploads** — already Schema-decoded by the router layer; no
  further guards downstream.
- **JSON blobs inside requests** (the import plan): `Schema.parseJson(PlanSchema)`
  replaces the guard-function stack in `products/router.ts`. Define the Schema next
  to the `ProductImportPlan` type (or derive the type from it) so they cannot drift.
- **LLM output** (`llm-proposer.ts`): a lenient Schema — `Schema.optionalWith`
  defaults, clamping transforms, `Schema.Literal` unions with fallback via
  `Schema.transformOrFail`/catch-all — replaces the `asString`/`clampConfidence`
  stack. The "repair invalid fields to defaults" behavior is preserved; it just
  lives in one declaration instead of 150 lines of imperative checks.
- **Raw SQL results**: one platform helper (`executeRows<T>(db, sql, RowSchema?)` in
  `platform/db`) owns the driver's `rows`-vs-array shape once; the four
  `as unknown as` copies in orders/users delete. Where cheap, pass a Row schema for
  actual decoding instead of a blind cast.
- **Error branching**: tagged errors + `Effect.catchTag`/`catchTags`, never
  `instanceof` chains (inventory, fulfillment, photos). `instanceof Error` remains
  legitimate only in last-resort cause-to-message formatting helpers — of which
  there should be one shared one, not five.
- **Environment**: a single `AppConfig` built on Effect `Config` (validated at
  startup, typed accessors, derived flags like `isProduction` / `isDevLike`
  computed once). Modules take config from the service; `process.env` reads outside
  `main.ts`/`AppConfig` are banned. This also ends the two competing definitions of
  "not production" in `auth.ts` and `host.ts`.
- **One `isRecord`, if any.** If a genuine unknown-walking utility is needed (the
  cause-formatter), it lives in `platform/effect`, not per file.

To keep implementation agents (Codex et al.) from regrowing this, encode the rule
where they read it: add to `backend/AGENTS.md` / `CLAUDE.md` a short guardrail —
*"Values past a Schema boundary are trusted: do not add `isRecord`/`typeof` guards,
re-validation, or `process.env` reads inside modules; decode at the boundary or fix
the type."* The review agents (`effect-reviewer`) should flag new `as unknown as`,
local `isRecord`, and module-level `process.env` as idiom violations.

### 3.8 Keep the blueprint current

`.claude/skills/effect-module` (the module scaffolding guide) is updated in the same
PR as any kit change, and gets a "new module checklist": factory config → service
helpers → tracer registration → route builder → catalog keys → RBAC layers → shared
types. That checklist is the future-proofing: a new module with nonstandard needs
finds the sanctioned extension point (soft-delete config, `extras`, composite guards,
audit callback) on the list instead of copying an old module.

## 4. Migration phases

Each phase is independently shippable; later phases depend on earlier ones only where
noted. Verify with `pnpm test` + the touched module's `test:integration` suite.

**Phase 0 — bug fixes (no refactor, ship first).**
1. Map `23505` on `products_tenant_sku_unique` → `SkuAlreadyExists` in
   `ProductsRepository.create` (fixes soft-deleted-SKU 500 and the create race).
   Decide separately whether the SKU index should become partial
   (`WHERE deleted_at IS NULL`) — that is a product decision about reusing SKUs of
   deleted products, not a refactor.
2. Return real ids from `updateMany`/`softDeleteMany`/`restoreMany`/`hardDeleteMany`;
   report them as `succeeded` (fixes the slice bug).
3. Add the missing price-below-cost check to `bulkCreate`.
4. Wrap orders `create` (order + items) and `delete` (items + order) in a
   transaction (fixes orphan orders).
   Regression tests for each.

**Phase 1 — kit construction.**
`makeTenantCrud` soft-delete + bulk + unique-violation + `withTransaction` (§3.1);
`ensureExistsById`/`ensureExistByIds` (§3.2); bulk pipeline helper; `pickDefined`;
catalog-sync test (§3.6). Pure additions, no module behavior changes.

**Phase 2 — products as reference consumer.**
Migrate `ProductsRepository` onto the extended factory (joined finders as extras);
adopt tracer + `ensureExistsById` + bulk helper in `ProductsService`; batch the
bulkCreate lookups (`findBySkus`, batched existence). Products becomes the copy-from
example for soft-delete modules.

**Phase 3 — migrate generation-1 repositories.**
orders, inventory, areas, notifications, photos onto `TenantQuery`/`makeTenantCrud`
(factory where CRUD-shaped, helpers-only where not, e.g. order items' subquery scope
becomes an extras helper). One module per PR. Tracer registration for
inventory/stock-movements rides along here.

**Phase 4 — router route builder.**
Introduce `tenantRoute`, convert products + orders routers, then the rest
opportunistically. Per-id audit entries for bulk routes land here.

**Phase 5 — boundary typing and config.** (independent of phases 2–4, can run in
parallel)
1. `AppConfig` service on Effect `Config`; migrate the 8+ `process.env` sites;
   delete the duplicated "not production" predicates.
2. `executeRows` helper; migrate orders/users raw-SQL casts.
3. Schema-ify the import-plan parse (router) and the LLM-proposal decode
   (llm-proposer); delete the guard stacks and two of the three `isRecord`s.
   Behavior lock: keep the lenient-repair semantics — golden tests on malformed
   LLM fixtures before/after.
4. Replace `instanceof` error branching with `catchTag`/`catchTags` in inventory,
   fulfillment, photos; one shared cause-to-message formatter.
5. Land the AGENTS.md/CLAUDE.md boundary-typing guardrail and extend
   `effect-reviewer` to flag regressions (§3.7).

**Phase 6 — consumer cleanup.**
Replace the ~11 hand-rolled existence checks across orders/inventory/stock-movements
with `ensureExistsById`; delete the now-dead per-consumer foreign error classes
(keep HTTP status/messageKey behavior — where an error class disappears, the
canonical one must map to the same status; note any messageKey changes in the PR).

## 5. Risks

- **Behavioral drift during migration** — mitigated by phase separation (bug fixes
  explicitly in Phase 0, everything after is behavior-preserving) and by integration
  tests per module; where a module lacks them, add a minimal happy-path +
  tenant-isolation spec before migrating it.
- **Factory over-generalization** — joins and workflow logic stay in `extras` by
  design; if an option would be used by one module only, it belongs in extras, not
  config.
- **Error-shape changes visible to clients** — unique-violation mapping changes some
  500s to 400s (strictly better, but note it in changelogs); Phase 6 error-class
  consolidation must preserve status codes and localized messages.
- **Lenient-decode fidelity** — the LLM-proposal Schema rewrite (Phase 5) must
  reproduce field-level repair behavior exactly; malformed-fixture golden tests are
  the gate, not code review.
- **CLAUDE.md guardrails** — no `Effect.fn` migration of traced methods, `onError`
  and messageKeys stay hand-typed in module code, platform services stay out of
  `dependencies:`. The kit is designed around these, not against them.
