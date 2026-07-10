# Stocket API

REST API for Stocket inventory management, built with Effect, Drizzle, Better Auth, and Node.js.

## Prerequisites

- Node.js 22
- pnpm 10.28.0 via Corepack
- PostgreSQL 16

This repo is a pnpm workspace. A single `pnpm install` from the workspace root installs the API and local Stocket packages under `packages/`.

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
pnpm start               # Run the API
pnpm start:worker        # Run the background task worker
pnpm build               # Production build
pnpm start:prod          # Run production build
pnpm start:prod:worker   # Run the production background worker
pnpm test                # Unit tests (Vitest)
pnpm test:integration    # Integration tests
pnpm lint                # Oxlint
pnpm type-check          # TypeScript check
SUPERADMIN_PASSWORD=<password> pnpm start:workspace # Fresh DBs get admin@stocket.fr
pnpm tenant:seed:workspace # Seed local tenant + tenant-admin@stocket.fr / admin1234
```

The API and task worker are separate processes built from the same image. Run
at least one worker process anywhere task-producing features are enabled. The
worker uses PostgreSQL leases, so multiple worker replicas can safely claim
work concurrently; tuning variables and defaults are documented in
`env.template`.

## Shared Types

Shared API contracts are linked into this workspace as `@stocket/types` from `../packages/types`.

When request/response shapes change:

1. update `../packages/types`
2. run `pnpm --filter @stocket/types barrels`
3. run `pnpm --filter @stocket/types build`
4. use the workspace-linked package directly from the API

## Authentication

All `/api/v1/*` endpoints require Better Auth authentication except the health check route.

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8080/api/v1/products
```
