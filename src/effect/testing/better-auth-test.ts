/**
 * Stubbed Better Auth Layer for tests.
 *
 * `UsersService` is the sole consumer of `BetterAuth.api` in application
 * code (see `backend/CLAUDE.md:29`). Integration and router tests that
 * exercise `UsersService` — directly or transitively — need a Better Auth
 * implementation that never opens sockets, never touches the real auth
 * tables, and returns predictable data.
 *
 * This module provides:
 *   - `makeBetterAuthStub(overrides?)` → a plain object matching the
 *     `BetterAuthService` shape. Default methods return sensible fake
 *     data keyed off the `userId`/`filterValue` in the request.
 *   - `makeBetterAuthTestLayer(overrides?)` → an `Effect.Layer` that
 *     provides the tag, suitable for `Layer.provide` in test setup.
 *
 * Downstream agents: pass `overrides` to inject specific user fixtures
 * or to assert on method calls (spy with `vi.fn()`).
 */
import { Layer } from 'effect';
import { BetterAuth, type BetterAuthService } from '../platform/auth/better-auth';

/** A minimal Better Auth user shape compatible with what the admin plugin returns. */
export interface FakeBetterAuthUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  banned: boolean;
  banReason: string | null;
  banExpires: string | Date | null;
  createdAt: string;
  role?: 'admin' | 'user';
}

export const makeFakeBetterAuthUser = (
  overrides: Partial<FakeBetterAuthUser> = {},
): FakeBetterAuthUser => ({
  id: overrides.id ?? '00000000-0000-4000-a000-000000000001',
  name: 'Test User',
  email: 'test@example.com',
  image: null,
  banned: false,
  banReason: null,
  banExpires: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'user',
  ...overrides,
});

interface ListUsersArgs {
  headers: globalThis.Headers;
  query: {
    limit?: number;
    offset?: number;
    filterField?: string;
    filterValue?: string;
    searchField?: string;
    searchValue?: string;
    searchOperator?: string;
  };
}

interface UserActionArgs {
  headers: globalThis.Headers;
  body: {
    userId: string;
    banReason?: string;
    banExpiresIn?: number;
  };
}

/**
 * Controls for the stub. `users` is the authoritative fixture set; default
 * methods filter/page against it. Pass `overrides` to replace any method
 * (e.g., for call-assertion with `vi.fn()` or to inject errors).
 */
export interface BetterAuthStubOptions {
  readonly users?: FakeBetterAuthUser[];
  readonly overrides?: Partial<BetterAuthService['api']>;
}

/**
 * Build the `BetterAuthService.api` surface. Returns defaults backed by
 * the `users` array. Spread `overrides` on top to customize per test.
 */
export function makeBetterAuthApi(
  opts: BetterAuthStubOptions = {},
): BetterAuthService['api'] {
  const users = opts.users ?? [makeFakeBetterAuthUser()];

  const defaults = {
    listUsers: async (args: ListUsersArgs) => {
      const { query } = args;
      let filtered = users;

      if (query.filterField === 'id' && query.filterValue) {
        filtered = filtered.filter((u) => u.id === query.filterValue);
      }
      if (
        query.searchField === 'name' &&
        query.searchValue &&
        query.searchOperator === 'contains'
      ) {
        const needle = query.searchValue.toLowerCase();
        filtered = filtered.filter((u) =>
          u.name.toLowerCase().includes(needle),
        );
      }

      const offset = query.offset ?? 0;
      const limit = query.limit ?? 20;
      const paged = filtered.slice(offset, offset + limit);

      return { users: paged, total: filtered.length };
    },
    banUser: async (_args: UserActionArgs) => undefined,
    unbanUser: async (_args: UserActionArgs) => undefined,
    removeUser: async (_args: UserActionArgs) => undefined,
    revokeUserSessions: async (_args: UserActionArgs) => undefined,
    requestPasswordReset: async (_args: {
      body: { email: string; redirectTo?: string };
      headers?: globalThis.Headers;
    }) => ({ status: true }),
  };

  return {
    ...(defaults as unknown as BetterAuthService['api']),
    ...opts.overrides,
  };
}

/**
 * A plain-object Better Auth stub. Use when you need to wire it directly
 * into `Layer.succeed(BetterAuth, stub)` or assert on method calls.
 */
export function makeBetterAuthStub(
  opts: BetterAuthStubOptions = {},
): BetterAuthService {
  const api = makeBetterAuthApi(opts);

  // The `auth` and `handler` fields of the real service are expensive to
  // construct. We provide inert stand-ins; any test that actually drives
  // the Better Auth HTTP handler should replace the full stub.
  const inert = (): never => {
    throw new Error(
      'Better Auth handler/auth are not available in tests. Override in makeBetterAuthStub if you need them.',
    );
  };

  return {
    api,
    // The three fields below are typed `typeof auth` / `typeof auth.handler`
    // in production. Cast through unknown to keep the test stub ergonomic —
    // we never call these unless a test explicitly overrides them.
    auth: { api, $context: Promise.resolve({ runMigrations: async () => {} }) } as unknown as BetterAuthService['auth'],
    handler: inert as unknown as BetterAuthService['handler'],
  };
}

/**
 * The canonical Better Auth test layer. Provide it alongside the Drizzle
 * test layer to satisfy `UsersService`'s dependencies in integration tests.
 */
export function makeBetterAuthTestLayer(
  opts: BetterAuthStubOptions = {},
): Layer.Layer<BetterAuthService> {
  return Layer.succeed(BetterAuth, makeBetterAuthStub(opts));
}
