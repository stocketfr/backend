# Module Standardization — Post-Implementation Review

**Status:** review of the implemented `plans/module-standardization.md` diff (113 files, +4828/−3269)
**Author's stance:** opinionated. This lists changes I would *not* have made as-is, with the
reasoning and a concrete fix for each. It is a corrections backlog, not a re-litigation of the
whole effort — most of the diff is good (see §1).

## 1. What landed well (leave alone)

So the critique below is trusted, not reflexive:

- `platform/effect/existence.ts` (`makeEnsureExistsById` / `makeEnsureExistByIds`) — clean,
  generic, exactly the intended shape. Batch form does one query.
- `platform/effect/run-bulk-by-ids.ts` — correct; `succeeded` comes from the ids `act`
  actually returned, killing the `slice(0, affectedCount)` bug at the root.
- `platform/config/app-config.ts` — real `Config`-based service, derived flags computed once,
  `orDie` at startup. This is the right way to kill the scattered `process.env` reads (minor
  trim in §6).
- `llm-proposer.ts` LLM decode — genuinely migrated to a lenient Schema (`LenientString`,
  `optionalWith` defaults, `Schema.transform`). The `isUnknownRecord` calls there are contained
  coercion *inside* the transform decoders, not the old guard stack. Fine.
- `products/router.ts` import-plan parse — now `Schema.decodeUnknown(Schema.parseJson(...))`.
  The ~90-line guard-function stack is gone. This is the win the plan wanted.

## 2. `execute-rows.ts` — a blind cast wearing a helper costume (fix)

The plan said: *"Where cheap, pass a Row schema for actual decoding instead of a blind cast."*
The implementation did the opposite — it centralized the cast and skipped the decode:

```ts
// platform/db/execute-rows.ts
return rows as TRow[];              // ← the whole point was to stop doing this
```

Every one of the 8 call sites passes a type argument that is now an unchecked assertion:
`executeRows<{ total: number }>`, `executeRows<TenantUserRow>`, `executeRows<{ value: unknown }>`
(orders, users ×3, superadmin ×3, dev-cleanup). We took four scattered `as unknown as` casts and
turned them into eight `as TRow[]` casts behind a friendlier name. That is worse: it *looks* safe
at the call site (`<TenantUserRow>` reads like decoding) while guaranteeing nothing.

**What I'd do instead.** Make the row type prove itself:

```ts
export const executeRows = async <A>(
  db: Pick<DrizzleDb, 'execute'>,
  query: SQL,
  rowSchema: Schema.Schema<A>,
): Promise<A[]> =>
  Schema.decodeUnknownSync(Schema.Array(rowSchema))(rawRows(await db.execute(query)));
```

Callers pass a `Schema.Struct`, not a phantom type param. For the trivial ones (the `nextval`
order-number query, the `count(*)` query) skip the helper entirely and decode the single scalar
inline — the raw-SQL escape hatch only exists because those aren't expressed through Drizzle's
typed builder; several (`count`, `exists`) *could* be, which removes the boundary altogether.
The `rawRows` shape-normalizer (`Array.isArray ? … : result.rows`) is legitimately the one place
that untyped concern belongs — keep that, drop the `as TRow[]` tail.

## 3. `platform/effect/unknown.ts` — canonizing the thing we were removing (fix)

This is the file you flagged, and the instinct is right. The plan's §3.7 rule was *"one
`isRecord`, if any … it lives in `platform/effect`, not per file"* — meant as a *ceiling*, a
grudging single fallback. The implementation read it as a *blessing* and exported a general-purpose
`isUnknownRecord` that is now imported in 6+ modules. We didn't eliminate the pattern; we gave it a
canonical home and a comfortable import, which invites more of it.

The exports, judged individually:

- `isUnknownRecord` — should **not** be a shared export. Its only defensible uses are genuine
  `unknown` boundaries (pg driver errors), and there it should be *inlined into that boundary's
  own module*, not offered to everyone. A shared `isUnknownRecord` is a standing invitation for
  an implementation agent to re-validate already-typed values "just in case."
- `messageFromUnknown` — the `isUnknownRecord(value) && typeof value.message === 'string'` walk is
  the sketchy part. As a *last-resort* cause-to-log-string formatter it's acceptable to have one,
  but 8 usages suggests it's being reached for where a typed error was already in hand.
- `errorFromUnknown` — `cause instanceof Error ? cause : new Error(...)`. Fine as an interop shim
  for throwing into non-Effect APIs; keep, but it's the only thing in this file that earns a home.

**What I'd do instead.** Delete `unknown.ts` as a general utility. Move
`pgUniqueViolationConstraintName`'s record check *into* `pg-errors.ts` (self-contained; see §4).
Keep a single `errorFromUnknown` (rename to `toError`, put it next to the try/promise helpers).
For `messageFromUnknown`, keep one internal copy in `platform/http/errors.ts` (the HTTP boundary
genuinely formats unknown failures) and have the 2–3 legitimate module callers import from there —
or better, have them `catchTag` the typed error and never see `unknown`. Every remaining
`isUnknownRecord` import outside a true boundary is a bug to chase, not an idiom to support.

## 4. `pg-errors.ts` — depends on the general record guard (small fix)

`pgUniqueViolationConstraintName` recursively walks `cause.cause` for `code === '23505'` using the
shared `isUnknownRecord`. The recursion + shared guard is more machinery than the boundary needs,
and it re-imports the thing §3 wants gone. Postgres driver errors (`postgres` / `pg`) carry `code`
and `constraint` on the top-level error object; Drizzle wraps but exposes `.cause` one level deep.

**What I'd do instead.** Inline a local, non-exported narrowing (`code`/`constraint` field check)
in this file, walk at most one `.cause` level, and drop the `seen`-set cycle guard (there is no
real cycle in a driver error chain — the `Set` is defensive scaffolding for a case that can't
happen). Self-contained boundary, no shared record guard.

## 5. Products forced onto `makeTenantCrud` — dead generated reads + a silent footgun (reconsider)

`ProductsRepository` was migrated to the factory, but products needs category/supplier joins on
**every read**, so all real read methods live in `extras`: `findByIdWithRelations`,
`findAllPaginatedWithRelations`, `findAllWithRelations`, `findByCategoryId(s)WithRelations`. The
service calls those exclusively (verified — service.ts references only the `*WithRelations`
variants for reads).

Meanwhile the factory still generates and exposes `findById`, `findAllPaginated` (join-less) on the
same service object. They are **never called** and return products with no relations. That's two
problems in one:

- **Dead surface:** the generated readers duplicate what the extras replace.
- **Footgun:** a future dev (or agent) writing `productsRepository.findById(id)` gets a compiling,
  plausible-looking call that silently returns a product missing `category`/`primary_supplier` —
  exactly the bug the DTO layer will then propagate. `findAllPaginatedWithRelations` also
  re-implements the count+data logic the factory's own `findAllPaginated` already owns, so the
  factory's list machinery is paid for and thrown away.

The write side *does* benefit (create/update/soft-delete/bulk now come from the factory with
unique-violation mapping), so this isn't "revert the whole thing." The mistake is forcing a
join-heavy module through a factory whose read generation it can't use.

**What I'd do instead — pick one:**
1. **Don't migrate products' reads.** Keep products a generation-2 module (`TenantQuery` helpers)
   for reads and use the factory only if it can generate *just* the write set. Cleanest
   conceptually; products is genuinely not a plain-CRUD table.
2. **Teach the factory to suppress generated reads it can't serve.** Add a `reads: false` (or
   `omit: ['findById','findAllPaginated']`) option so a join-heavy consumer opts out of the
   join-less readers instead of shadowing them with parallel `*WithRelations` names. Then the extra
   methods can reclaim the canonical names and the footgun disappears.

Option 2 generalizes for the next join-heavy module (orders has the same shape); option 1 is less
work now. I lean 2 if a second module needs it, 1 if products stays the only one.

## 6. `tenant-route.ts` — earns scrutiny for its generic weight (assess, then slim)

Adopted in 15/20 routers, so this is load-bearing and I would *not* rip it out. But as written it's
a mega-config with nine type parameters
(`Input, DecodeError, DecodeContext, A, E, R, B, GuardError, GuardContext`) and several redundant
knobs, and it still contains an `as unknown as` at line 62 (the `pathParams` search-params cast it
was partly meant to centralize — fine that it's contained, but it *is* still there).

Redundancies I'd remove:

- **`permission?` and `permissions?`** both exist and are concatenated. Two ways to say one thing.
  Keep `permissions: readonly [...]` only; a single permission is a one-element array.
- **`audit` as value-or-function** plus **`mapResponse`** plus **`response: 'json' | 'empty'`**
  plus **`responseOptions`** is a lot of response-shaping surface on every route. Most routes use a
  fraction of it. I'd split: a plain `tenantRoute` (permissions + decode + handler + json response)
  covering the ~80% case, and let the genuinely-special routes (audited mutations, empty responses,
  multipart) compose the smaller existing helpers (`respondAuditedMutation`, `respondEmpty`)
  directly rather than routing every option through one 9-generic signature.

This is a judgment call, not a defect — flagging it so it gets a deliberate "yes this complexity is
worth it" rather than inheriting it by default. If the team likes the single entry point, at least
collapse `permission`/`permissions` and document why the generics are what they are.

## 7. `fulfillment` error detection — reinvents `catchTags` with a drift-prone string Set (fix)

```ts
const fulfillmentErrorTags = new Set([ 'FulfillmentOrderNotFound', ... ]);   // hand-maintained
const isFulfillmentError = (cause: unknown): cause is FulfillmentError =>
  isUnknownRecord(cause) && typeof cause._tag === 'string' && fulfillmentErrorTags.has(cause._tag);
```

This is precisely the anti-pattern the plan named (§ inventory item 10) — inspecting `_tag` on an
`unknown` through a record guard, with a literal Set of tag strings that must be manually kept in
sync with the error classes. Add a sixth `Fulfillment*` error and this silently misclassifies it.
It also drags in the §3 `isUnknownRecord`.

**What I'd do instead.** These are Effect tagged errors; use `Effect.catchTags({ FulfillmentOrderNotFound: …, … })`
or, where a single boolean is genuinely needed at a non-Effect boundary, derive the tag set from the
error classes rather than a duplicated string literal. The type system then enforces exhaustiveness
and the Set can't drift.

## 8. Cross-cutting note for the agent guardrails

The through-line in §2/§3/§4/§7: the implementation satisfied the *letter* of "centralize the
boundary" by creating shared helpers, but several of those helpers **preserve the untyped behavior
instead of removing it** (`as TRow[]`, exported `isUnknownRecord`, `_tag` string Set). A shared
helper that still casts/inspects is more dangerous than the inline version it replaced, because it
launders the smell into something that looks sanctioned and gets imported widely.

Sharpen the CLAUDE.md/AGENTS.md rule accordingly (one line):
> A shared boundary helper must *decode or narrow to a real type*. Centralizing an `as`-cast or a
> `typeof`/record check into a reusable export is not allowed — if the helper still returns
> `x as T`, it hasn't solved anything.

And point `effect-reviewer` at: exported `is*Record` guards, `executeRows<T>`/`db.execute` calls
without a row schema, and `_tag`-string Sets.

## 9. Suggested order

1. §2 `executeRows` decode + §4 `pg-errors` inline + §3 `unknown.ts` teardown — same theme, do
   together; small, high signal, directly the pattern you want gone.
2. §7 fulfillment `catchTags` — isolated, mechanical.
3. §5 products factory fit — decide option 1 vs 2; touches real behavior, needs the integration
   tests green (they exist now).
4. §6 tenant-route slim — largest blast radius (15 routers); do last, deliberately, or defer if the
   team is happy with the single entry point.
5. §8 guardrail wording — land alongside §1–§4 so the next agent pass doesn't regrow it.
