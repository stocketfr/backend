# Stocket API

REST API for Stocket inventory management, built with Effect, Drizzle, Better Auth, and Node.js.

## Prerequisites

- Node.js 22
- pnpm 10.28.0 via Corepack
- PostgreSQL 16

This repo is a pnpm workspace. Shared Stocket packages are installed from GitHub Packages at immutable versions.

GitHub Packages requires authentication. Create a classic GitHub token with
`read:packages`, expose it as `GITHUB_PACKAGES_TOKEN`, and configure pnpm once:

```bash
pnpm config set --global @stocketfr:registry https://npm.pkg.github.com
pnpm config set --global //npm.pkg.github.com/:_authToken "${GITHUB_PACKAGES_TOKEN}"
```

## Getting Started

```bash
# From the workspace root
pnpm install

# Start in dev mode with Infisical-injected env vars (needs PostgreSQL running)
pnpm start
```

The API will be at `http://localhost:8080`.

### Environment Variables

Environment values are managed in Infisical and injected at runtime by the npm
scripts. The checked-in `env.template` file documents the expected keys.

## Project Structure

```text
src/
├── effect/
│   ├── main.ts            # HTTP API entrypoint
│   ├── task-worker.ts     # Background task worker entrypoint
│   ├── http/              # HTTP app, middleware, logging, security headers
│   ├── modules/           # Routers, services, repositories, schemas, errors
│   └── platform/          # Drizzle, Better Auth, request/session/audit helpers
├── auth.ts                # Better Auth setup
└── scripts/               # Seed/import scripts
test/
└── mocks/                 # Auth/UUID test helpers
```

Most business features live under `src/effect/modules/<feature>/` with the pattern:

- `router.ts`: HTTP boundary
- `service.ts`: application logic
- `repository.ts`: DB access
- `*.schema.ts`: request/query decoding
- `*.errors.ts`: tagged domain/infrastructure errors

## Commands

```bash
pnpm install             # Install the workspace
pnpm migrate:predeploy:dev # Migrate the development database before startup
pnpm start               # Run the API
pnpm start:worker        # Run the background task worker
pnpm build               # Production build
pnpm start:prod          # Run production build
pnpm start:prod:worker   # Run the production background worker
pnpm test                # Unit tests (Vitest)
pnpm test:integration    # Integration tests
pnpm lint                # Oxlint
pnpm type-check          # TypeScript check
SUPERADMIN_PASSWORD=<password> pnpm start:workspace # Start the local API after migration
pnpm tenant:seed:workspace # Seed local tenant + tenant-admin@stocket.fr / admin1234
```

API and worker startup never run migrations. Run the development migration
command after pulling migrations and before starting either process, including
when creating a fresh local database.

The API and task worker are separate processes built from the same image. Run
at least one worker process anywhere task-producing features are enabled. The
worker uses PostgreSQL leases, so multiple worker replicas can safely claim
work concurrently; tuning variables and defaults are documented in
`env.template`.

`POST /api/v1/products/import` stores the uploaded CSV under the
`background-tasks/product-import/` object prefix and responds with `202` plus a
`Location` header for the task. Terminal tasks delete their input object after
database settlement. Configure an object-storage lifecycle rule for that prefix
as a fallback for crashes between object upload/enqueue or settlement/cleanup.

## Production database migrations

Every deployment must run exactly one pre-deploy operation from the target
image, after the image is built and before starting the new API or worker:

```bash
node dist/effect/pre-deploy-migrate.cjs
```

Use `node` directly in the production container; the slim runtime image does
not rely on pnpm or development dependencies. The command needs the same
database, Better Auth, frontend/tenant, mailer, and `SUPERADMIN_*` environment
configuration as the API. It must connect directly to PostgreSQL rather than
through a transaction-pooling proxy.

The command holds a session-level PostgreSQL advisory lock for its full run, so
duplicate or concurrent deployment jobs wait and then rerun idempotently. Under
that lock it performs, in order:

1. committed `drizzle/*.sql` migrations;
2. Better Auth migrations and schema repair;
3. versioned data migrations, including the platform superadmin;
4. default system-role seeding; and
5. the schema-ready marker update.

The marker advances only after every step succeeds. API and worker processes
perform a read-only compatibility check while acquiring their shared database
layer and exit before binding a port or claiming tasks when the schema is
behind, incomplete, or incompatibly ahead. Neither startup path mutates schema
or seed data. The migration command suppresses Drizzle SQL logging even when
`LOG_SQL=full`; it does not print SQL, connection strings, credentials, or seed
values.

### Migration compatibility convention

Every committed SQL file must begin with exactly one of:

```sql
-- stocket:previous-app-compatible=true
-- stocket:previous-app-compatible=false
```

`true` is a strong, transitive promise: the migration is safe for every older
application image that remains a supported rollback target, not only the
immediately preceding commit. Additive nullable columns and independent tables
are typical `true` changes. Drops, renames, stricter constraints, and semantic
rewrites are `false` unless an expand/contract rollout proves otherwise.

The flag is copied into `stocket_committed_migrations`, allowing an older image
to make its own rollback decision after a newer migration. Any change to Better
Auth schema, TypeScript data migrations, role seeds, or another pre-deploy step
must also add a committed SQL marker file (a comment-only migration is valid)
so the image's expected schema version advances. CI rejects SQL files without
the first-line declaration.

### Failure recovery and rollback

- If pre-deploy fails, do not start the new API or worker. Fix the cause and
  rerun the same target image; do not delete or edit migration/version rows.
  Completed SQL files are transactional and all remaining stages are designed
  for idempotent retry.
- A failed incompatible migration can also prevent the previous image from
  restarting, while already-running processes do not re-check the gate. For a
  `false` migration, drain all old API and worker processes before pre-deploy and
  use an explicit maintenance window.
- Image rollback is safe only when every database migration newer than the
  rollback image is marked `true`. If any is `false`, roll forward with a repair
  image or restore a database backup taken before pre-deploy; rolling back only
  the image is unsafe and the startup gate intentionally rejects it.
- Take and verify the database backup before any `false` migration. A lost
  advisory-lock connection aborts the command and must be investigated before
  retrying.

## Shared Types

Shared API contracts are consumed as `@stocket/types`, backed by the versioned
`@stocketfr/types` package in GitHub Packages.

When request/response shapes change:

1. update `stocketfr/packages` and add a Changeset
2. use the package PR's immutable snapshot version for coordinated testing
3. merge the package version PR to publish a stable release
4. let Dependabot update the pinned package version

## Authentication

All `/api/v1/*` endpoints require Better Auth authentication except the health check route.

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8080/api/v1/products
```
