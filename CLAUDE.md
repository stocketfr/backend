# Global Agents Config

## Version Control: prefer jj over git

When a repo has a `.jj/` directory (run `jj root` to check), use `jj` instead of `git` for VCS operations. Most of my repos are jj-colocated with git — assume jj unless `jj root` fails.

## Planning First

Do not jump straight into implementation for substantial or ambiguous work:

1. **Understand the problem** — read the relevant code, ask clarifying questions, and make sure you know what's actually going on before proposing changes.
2. **Draft a lightweight plan** — outline the approach, files involved, and key decisions when the task is non-trivial. A plan can be only two or three bullets when the path is clear.
3. **Stress-test only when warranted** — use the grill-me skill or equivalent workflow only for complex, high-risk, product/design-heavy, or explicitly requested planning. Do not invoke it for routine code edits, small refactors, simple bug fixes, or tasks where the path is obvious.
4. **Then implement** — after the plan is clear enough for the task size.

A "trivial" change is a one-liner, a typo fix, a small config/content edit, or something the user explicitly tells you to just do. Trivial changes can be implemented directly. Do not wait for explicit approval after presenting a plan unless the user asked for planning only, the change is risky, or the next step is genuinely ambiguous.

## Verification

Before saying work is complete, run the smallest relevant verification command
available. Prefer fast local checks first. If verification cannot be run, say
exactly what was skipped and why.

## Shells

Use POSIX-compatible shell syntax for normal agent tool calls and commands that need to run reliably in project scripts, CI, Makefiles, package scripts, or other standard shell contexts. Use Bash-specific syntax only when the target context is Bash.

Nushell is the primary interactive shell for the user. Prefer Nushell only when generating commands, scripts, or one-liners intended for the user to run interactively, especially when structured-data pipelines are clearer than POSIX text-munging. If using Nushell from a Bash-oriented tool call, invoke it explicitly with `nu -c '...'`.

**Nushell substitutions for user-facing commands:**

- `grep` → `where`, `find`, or `str contains`
- `awk` / `cut` → `get`, `select`, `columns`
- `sed` → `str replace`
- `wc -l` → `length`
- `sort | uniq -c` → `group-by | transpose`
- `xargs` → `each { |it| ... }`
- `jq` → native `from json` + `get` / `where`
- `head` / `tail` → `first N` / `last N`
- `find . -name` → `ls **/*pattern*` or `glob`

**When Bash/POSIX is still right:**

- Agent tool calls where Bash/POSIX is the expected execution environment.
- Target is a Bash/POSIX script, CI step, Makefile, README example, or package script.
- Tool shells out via `system()` or similar and won't pick up Nushell.
- Piping to a tool that expects raw text on stdin in a way Nushell would mangle.

## Remote Dev Fleet

Use `fleet list` to see trusted development machines declared by Nix, and read
`~/.config/fleet/FLEET.md` for host capabilities and placement decisions.
Prefer `fleet ssh <host>` for interactive tmux work, `fleet shell <host>` for a
plain SSH shell, and `fleet run <host> <command...>` for non-interactive checks.
Direct tmux SSH aliases also exist as `tm-<host-or-alias>`, for example
`ssh tm-main-pc`.

Use `fleet forward <host> <local-port> <remote-port> [remote-host]` for port
forwards.

Fleet inventory is generated from `modules/fleet/home-manager.nix`; do not edit
generated `~/.config/fleet/hosts.json`, `~/.config/fleet/FLEET.md`, or SSH
config directly. Read `modules/fleet/README.md` before adding a host or
changing the workflow.

Treat fleet machines as trusted internal hosts. SSH agent forwarding is enabled
for interactive work so Git and agent tools can use your local SSH credentials.
Scheduled or unattended agent runs must not rely on forwarded SSH credentials;
interactive sessions only.

## Shared Prompts

Reusable prompts live in `~/.agents/prompts`. Agent-specific prompt or command
surfaces may symlink those same files into their native locations; prefer editing
the shared source under `users/maxpw/agents/shared/prompts` instead of copying
prompt text per agent.

--- project-doc ---

# Stocket API Module

## Tooling

- Use **pnpm** from the workspace root for dependencies and script execution.
- **pnpm** runs the API: `pnpm start`.
- `pnpm-lock.yaml` at the workspace root is the lockfile.

## Boundaries

- Keep feature work under `src/effect/modules/<feature>/` and follow the existing router/service/repository/schema/error split.
- Normal persisted feature modules should use the same top-level file roles: `router.ts` for HTTP wiring, `service.ts` for orchestration and the public Effect interface, `repository.ts` for persistence, `<feature>.errors.ts` for typed errors, `types.ts` for module-local types, and `<feature>.utils.ts` for pure helpers. Do not create empty or pass-through files just for symmetry.
- Use recognized optional files instead of ad hoc helper names: `access.ts` for `require*` auth/role/feature/permission checks, `mappers.ts` for representation translation across seams, and `utils/` for split pure helper domains once `<feature>.utils.ts` mixes distinct concerns.
- Keep `utils` pure: parsing, normalization, formatting, comparison, duplicate detection, and small mappers are fine; anything that reads context, checks permissions, calls services/repositories, opens transactions, or fails with workflow-specific typed errors belongs in `service.ts`, `access.ts`, or another named workflow file.
- For large feature-specific workflows, prefer a subfolder under the module (for example `products/import/`) with its own `router.ts`, `service.ts`, `repository.ts`, `types.ts`, `utils.ts`, optional `access.ts`/`mappers.ts`, and tests so normal module behavior stays readable.
- Keep `service.ts` focused on orchestration. Move module-local row aliases, options, caches, DTO re-exports, and literal tuples to `types.ts`; move pure parsing, normalization, formatting, comparison, and duplicate-detection helpers to `utils.ts`.
- Before adding new row types, literal lists, parsers, or fixture blocks, search for existing equivalents and reuse or centralize them when the behavior is shared.
- Cross-module access should normally go through services, not another module's repository.
- Shared request/response contracts should come from `@stocket/types`, not backend-local DTO files.
- `UsersService` talks to Better Auth admin APIs directly and uses local persistence for role assignment concerns.
- `AuditLogWriter` is fire-and-forget; do not build correctness around audit writes succeeding synchronously.

## Effect Guardrails

- Prefer `Effect.merge(e)` over `Effect.catchAll(e, (err) => Effect.succeed(err))`.
- Prefer `Effect.filterOrFail(predicate, () => err)` for boolean checks; use `Boolean` for raw boolean values.
- Prefer `Effect.mapError((e) => new XError(e))` over catch-and-refail wrappers.
- Prefer `Effect.tapError(cleanup)` plus `Effect.ignore(...)` for side-effecting cleanup that must refail with the original error.
- Prefer `Effect.void` over `Effect.succeed(undefined)`.
- Use `makeTryAsync` for promise wrappers that map every failure to the module's infrastructure error. Keep raw `Effect.tryPromise` when each call uses a distinct hand-typed `MessageKey`.
- Do not declare `DrizzleDatabase` or `BetterAuth` as service `dependencies:`; they are provided once through `platformLayer`.
- Do not replace `src/effect/platform/service-tracer.ts` or migrate service methods to `Effect.fn` without explicit direction.

## Reuse Platform Abstractions

(Context: `plans/module-standardization.md` — these exist to stop re-implementing cross-cutting concerns per module.)

- Tenant scoping in repositories goes through `TenantQuery` (`whereTenant*`, `insertValues`) or `makeTenantCrud` (`src/effect/platform/db/tenant-crud.ts`). Never hand-build `eq(table.tenant_id, ...)` predicates.
- New CRUD repositories start from `makeTenantCrud`; bespoke queries go in `extras` so they ride the same tenant fence and error wrapping.
- Service spans come from `makeServiceTracer` (register the module in `TraceModule`); do not hand-roll `Effect.withSpan` in services.
- To check that a foreign entity exists, call the owning module's service and fail with its canonical NotFound error; do not define new "X not found" error classes in consumer modules.
- Uniqueness is enforced by DB constraints; pre-checks are UX sugar. Map pg `23505` on a known constraint to the domain error instead of letting it surface as an infrastructure 500.
- Multi-statement writes (parent + children, check-then-write transitions) run in `db.transaction`, or move the state check into the UPDATE's WHERE and treat 0 affected rows as the domain error.
- Bulk operations report `succeeded` from the ids actually returned by `.returning()`, never `ids.slice(0, affectedCount)`.

## Types at the Boundary

- Decode external input exactly once, at the boundary, with Effect Schema. Past a Schema boundary values are trusted: no `isRecord`/`typeof` guards, no re-validation, no defensive fallbacks on already-typed values.
- JSON embedded in requests and LLM output are boundaries too: decode them with `Schema.parseJson` or a lenient Schema (optional-with-default, clamping transforms) — never hand-written guard-function stacks.
- Do not add `as unknown as` / `as any` / `as never` casts; fix the type, or contain the boundary in one typed platform helper.
- A shared boundary helper must decode or narrow to a real type. Do not centralize an `as` cast or a `typeof`/record check into a reusable export; a helper that returns `x as T` has not solved the boundary.
- Branch on typed errors with `Effect.catchTag`/`catchTags`, never `instanceof` chains. `instanceof Error` is only for last-resort cause formatting in a shared helper.
- Do not read `process.env` inside `src/effect/modules/**`; environment access belongs to startup/platform config. Never invent a new `NODE_ENV` predicate — reuse the existing derived flags.

## Structured Logging

- Log message arguments must use properties defined in `LogProperties` (`src/effect/platform/messages.ts`).
- When adding a message placeholder, add the matching `LogProperties` field and update every locale catalog.
- Use `createLogger(scope)` so message keys are scoped consistently.

## Shared Types

When request/response shapes change:

1. Update `packages/types`.
2. Run `pnpm --filter @stocket/types barrels && pnpm --filter @stocket/types build`.
3. Use the workspace-linked types directly from the backend.

## Testing

- Run unit tests with `pnpm test`; integration tests use `pnpm test:integration`.
- Choose the smallest test boundary that catches the likely regression; use integration/acceptance tests when correctness depends on real SQL, transactions, tenant isolation, or full HTTP composition.
- For detailed backend testing patterns, read `TESTING.md` instead of duplicating guidance here.
- If type-check fails, confirm whether the failure is from your change before chasing unrelated errors.

## Issue Tracking

Before starting work on any issue, ensure it is added to the **[Stocket Improvements Tracker](https://github.com/orgs/stocketfr/projects/2)** GitHub Project. Move the issue to "In Progress" when starting and "Done" when complete.
