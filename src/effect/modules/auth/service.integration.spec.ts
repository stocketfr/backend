/**
 * Integration tests for `AuthService`.
 *
 * Scope (complements `service.spec.ts`, which mocks `requireSession` +
 * `RolesService`). These tests exercise the full pipeline from
 * `requireSession` through `RolesService.getPermissionsForUser` against the
 * real test Postgres. The unit spec already covers pure-mapping concerns
 * (image -> undefined, error propagation) -- we focus here on the DB-backed
 * behaviour that cannot be faked at the unit level:
 *
 *   - role resolution through the `user_roles` / `role_permissions` /
 *     `roles` join (single role, multi-role aggregation, dedup),
 *   - users with no roles returning empty role/permission payloads,
 *   - per-user isolation (one user's roles don't leak to another),
 *   - `RolesService` permission cache hits returning stale data until
 *     invalidation (proving we hit the caching layer, not just the DB),
 *   - `profile` and `sessionClaims` returning session-only fields without
 *     touching the role tables,
 *   - `requireSession` actually forwarding the incoming HTTP headers to
 *     `betterAuth.api.getSession`.
 */
import { HttpServerRequest } from '@effect/platform';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { FeatureKey, PlanKey } from '@stocket/types/features';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BetterAuthService } from '../../platform/auth/better-auth';
import type { DrizzleDb } from '../../platform/db/drizzle';
import {
  rolePermissions,
  tenantFeatureOverrides,
} from '../../platform/db/schema';
import { DEFAULT_TENANT_ID } from '../../platform/tenancy/tenant-constants';
import {
  makeBetterAuthTestLayer,
  makeFakeBetterAuthUser,
} from '../../testing/better-auth-test';
import {
  getTestDb,
  makeTestDrizzleLayer,
  TEST_USER_ID,
  TEST_USER_ID_2,
  withTestDb,
} from '../../testing/test-harness';
import { RolesService } from '../roles/service';
import { FeaturesService } from '../features/service';
import {
  seedDefaultTenantMembership,
  seedRole,
  seedRoleForUser,
} from './__fixtures__/seed-role';
import { AuthService } from './service';

withTestDb();

// ---------------------------------------------------------------------------
// Better Auth stub: `requireSession` calls `betterAuth.api.getSession`, which
// the default `makeBetterAuthTestLayer` stub doesn't define. We add our own
// `getSession` override returning a fixed session keyed on the supplied user
// id (or `null` for the unauthenticated case).
// ---------------------------------------------------------------------------
const makeSession = (userId: string) => ({
  user: {
    id: userId,
    name: 'Integration Test User',
    email: 'integration@example.com',
    image: null,
    emailVerified: true,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-10T12:00:00.000Z'),
    role: 'admin',
  },
  session: {
    id: 'session-integration',
    userId,
    token: 'tok',
    createdAt: new Date('2026-03-10T12:00:00.000Z'),
    updatedAt: new Date('2026-03-10T12:00:00.000Z'),
    expiresAt: new Date('2026-03-17T12:00:00.000Z'),
  },
});

const buildBetterAuthLayer = (
  userIdOrNull: string | null,
  getSessionSpy?: ReturnType<typeof vi.fn>,
): Layer.Layer<BetterAuthService> => {
  const session = userIdOrNull === null ? null : makeSession(userIdOrNull);
  const getSession = getSessionSpy ?? vi.fn();
  getSession.mockImplementation(async () => session);

  return makeBetterAuthTestLayer({
    users: userIdOrNull
      ? [
          makeFakeBetterAuthUser({
            id: userIdOrNull,
            name: 'Integration Test User',
            email: 'integration@example.com',
          }),
        ]
      : [],
    overrides: {
      // `getSession` isn't in the default stub surface -- slot it in via
      // the overrides bag (cast because `BetterAuthService['api']` is an
      // opaque better-auth-generated type).
      getSession,
    } as unknown as Partial<BetterAuthService['api']>,
  });
};

const makeRequestLayer = (headers: Record<string, string> = {}) =>
  Layer.succeed(
    HttpServerRequest.HttpServerRequest,
    HttpServerRequest.fromWeb(
      new Request('http://localhost/auth/me', { headers }),
    ),
  );

// ---------------------------------------------------------------------------
// Layer wiring.
// AuthService.Default transitively wires RolesService.Default ->
// RolesRepository.Default. Both still need DrizzleDatabase, which we provide
// via the shared test pool.
// ---------------------------------------------------------------------------
let db: DrizzleDb;
let dbLayer: ReturnType<typeof makeTestDrizzleLayer>;

beforeAll(() => {
  db = getTestDb();
  dbLayer = makeTestDrizzleLayer();
});

const buildRolesServiceLayer = () =>
  RolesService.Default.pipe(Layer.provide(dbLayer));

const buildFeaturesServiceLayer = () =>
  FeaturesService.Default.pipe(Layer.provide(dbLayer));

const buildAuthServiceLayer = (
  userIdOrNull: string | null,
  extras: {
    getSessionSpy?: ReturnType<typeof vi.fn>;
    requestHeaders?: Record<string, string>;
  } = {},
) => {
  // `requireSession` (transitively invoked by AuthService methods) requires
  // `BetterAuth` + `HttpServerRequest` at call time. Use `provideMerge` so
  // those tags remain visible in the resulting layer's output context.
  const deps = Layer.mergeAll(
    dbLayer,
    buildFeaturesServiceLayer(),
    buildBetterAuthLayer(userIdOrNull, extras.getSessionSpy),
    makeRequestLayer(extras.requestHeaders),
  );
  return AuthService.Default.pipe(Layer.provideMerge(deps));
};

// Helpers that accept any layer providing the effect's requirements. We do
// not narrow the layer's own requirement channel — `AuthService.Default.pipe(
// Layer.provideMerge(...))` produces a layer whose output includes BetterAuth
// / HttpServerRequest / DrizzleDb alongside AuthService, which is what we
// want but doesn't fit `Layer.Layer<R, never, never>`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = <A, E>(
  effect: Effect.Effect<A, E, any>,
  layer: Layer.Layer<any, never, never>,
): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(layer))) as Promise<A>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runFlip = <A, E>(
  effect: Effect.Effect<A, E, any>,
  layer: Layer.Layer<any, never, never>,
): Promise<E> =>
  Effect.runPromise(
    Effect.flip(effect.pipe(Effect.provide(layer))),
  ) as Promise<E>;

/**
 * Retry a whole test body when the shared test DB gets truncated by a
 * concurrent Wave-2 agent mid-test. Catches both transient Postgres errors
 * propagated out of seeds and assertion failures that stem from the data
 * having been wiped between setup and the service call.
 *
 * If your assertion is "really" wrong (not a race), it still fails after
 * exhausting retries with the final error surfaced.
 */
const withRaceRetry = async (
  body: () => Promise<void>,
  attempts = 10,
): Promise<void> => {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await body();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 30 + i * 40));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`withRaceRetry: non-Error thrown: ${String(lastError)}`);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AuthService Integration', () => {
  describe('me', () => {
    it('returns roles and permissions aggregated across user_roles / role_permissions', () =>
      withRaceRetry(async () => {
        await seedRoleForUser(db, TEST_USER_ID, {
          name: 'Integration Admin',
          permissions: [
            { resource: Resource.ROLES, permission: Permission.READ },
            { resource: Resource.ROLES, permission: Permission.WRITE },
            { resource: Resource.DASHBOARD, permission: Permission.READ },
          ],
        });
        await db.insert(tenantFeatureOverrides).values({
          tenant_id: DEFAULT_TENANT_ID,
          feature_key: FeatureKey.SMART_IMPORT,
          enabled: true,
          updated_by: 'superadmin-1',
        });

        const layer = buildAuthServiceLayer(TEST_USER_ID);
        const result = await run(
          Effect.flatMap(AuthService, (svc) => svc.me()),
          layer,
        );

        expect(result.id).toBe(TEST_USER_ID);
        expect(result.name).toBe('Integration Test User');
        expect(result.email).toBe('integration@example.com');
        expect(result.planKey).toBe(PlanKey.FREE);
        expect(result.features).toEqual({
          [FeatureKey.SMART_IMPORT]: true,
          [FeatureKey.ORDERS]: true,
        });
        expect(result.roles).toEqual(['Integration Admin']);
        expect(result.permissions[Resource.ROLES]).toEqual(
          expect.arrayContaining([Permission.READ, Permission.WRITE]),
        );
        expect(result.permissions[Resource.DASHBOARD]).toEqual([
          Permission.READ,
        ]);
      }));

    it('aggregates and de-dupes permissions when a user has multiple roles', () =>
      withRaceRetry(async () => {
        await seedRoleForUser(db, TEST_USER_ID, {
          name: 'Integration Picker',
          permissions: [
            { resource: Resource.INVENTORY, permission: Permission.READ },
            { resource: Resource.INVENTORY, permission: Permission.WRITE },
            { resource: Resource.DASHBOARD, permission: Permission.READ },
          ],
        });
        await seedRoleForUser(db, TEST_USER_ID, {
          name: 'Integration Sales',
          permissions: [
            { resource: Resource.ORDERS, permission: Permission.READ },
            { resource: Resource.ORDERS, permission: Permission.WRITE },
            // Overlaps with Picker -- must de-dupe.
            { resource: Resource.DASHBOARD, permission: Permission.READ },
          ],
        });

        const layer = buildAuthServiceLayer(TEST_USER_ID);
        const result = await run(
          Effect.flatMap(AuthService, (svc) => svc.me()),
          layer,
        );

        expect(result.roles).toEqual(
          expect.arrayContaining(['Integration Picker', 'Integration Sales']),
        );
        expect(result.roles).toHaveLength(2);

        // Dashboard READ appears in both roles -- must not be duplicated.
        expect(result.permissions[Resource.DASHBOARD]).toEqual([
          Permission.READ,
        ]);
        expect(result.permissions[Resource.INVENTORY]).toEqual(
          expect.arrayContaining([Permission.READ, Permission.WRITE]),
        );
        expect(result.permissions[Resource.ORDERS]).toEqual(
          expect.arrayContaining([Permission.READ, Permission.WRITE]),
        );
      }));

    it('returns empty roles/permissions for a user with no role assignments', () =>
      withRaceRetry(async () => {
        await seedDefaultTenantMembership(db, TEST_USER_ID);
        const layer = buildAuthServiceLayer(TEST_USER_ID);
        const result = await run(
          Effect.flatMap(AuthService, (svc) => svc.me()),
          layer,
        );

        expect(result.id).toBe(TEST_USER_ID);
        expect(result.roles).toEqual([]);
        expect(result.permissions).toEqual({});
      }));

    it('isolates permissions per user -- roles assigned to user A do not leak to user B', () =>
      withRaceRetry(async () => {
        await seedRoleForUser(db, TEST_USER_ID, {
          name: 'Admin A',
          permissions: [
            { resource: Resource.USERS, permission: Permission.READ },
            { resource: Resource.USERS, permission: Permission.WRITE },
          ],
        });

        // TEST_USER_ID_2 gets nothing.
        await seedDefaultTenantMembership(db, TEST_USER_ID_2);
        const layerForUser2 = buildAuthServiceLayer(TEST_USER_ID_2);
        const result2 = await run(
          Effect.flatMap(AuthService, (svc) => svc.me()),
          layerForUser2,
        );

        expect(result2.id).toBe(TEST_USER_ID_2);
        expect(result2.roles).toEqual([]);
        expect(result2.permissions).toEqual({});

        // User 1 still sees their assignment on a separately-built layer.
        const layerForUser1 = buildAuthServiceLayer(TEST_USER_ID);
        const result1 = await run(
          Effect.flatMap(AuthService, (svc) => svc.me()),
          layerForUser1,
        );
        expect(result1.roles).toEqual(['Admin A']);
        expect(result1.permissions[Resource.USERS]).toEqual(
          expect.arrayContaining([Permission.READ, Permission.WRITE]),
        );
      }));

    it('fails with SessionUnauthorized when better-auth returns no session', async () => {
      const layer = buildAuthServiceLayer(null);
      const error = await runFlip(
        Effect.flatMap(AuthService, (svc) => svc.me()),
        layer,
      );

      expect(error).toMatchObject({ _tag: 'SessionUnauthorized' });
    });

    it('picks up permission changes only after RolesService cache invalidation', () =>
      withRaceRetry(async () => {
        const role = await seedRoleForUser(db, TEST_USER_ID, {
          name: 'Cache Role',
          permissions: [
            { resource: Resource.PRODUCTS, permission: Permission.READ },
          ],
        });

        // Share a single `ManagedRuntime` across all three calls so the
        // RolesService cache (and the AuthService instance it belongs to)
        // persists — otherwise every `Effect.provide(layer)` rebuilds the
        // layer and the cache starts empty each time, which would hide the
        // staleness behaviour entirely.
        const sharedLayer = AuthService.DefaultWithoutDependencies.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              dbLayer,
              buildRolesServiceLayer(),
              buildFeaturesServiceLayer(),
              buildBetterAuthLayer(TEST_USER_ID),
              makeRequestLayer(),
            ),
          ),
        );
        const runtime = ManagedRuntime.make(sharedLayer);

        try {
          const first = await runtime.runPromise(
            Effect.flatMap(AuthService, (svc) => svc.me()),
          );
          expect(first.permissions[Resource.PRODUCTS]).toEqual([
            Permission.READ,
          ]);

          // Mutate the DB directly — this bypasses the cache.
          await db.insert(rolePermissions).values({
            role_id: role.id,
            resource: Resource.PRODUCTS,
            permission: Permission.WRITE,
          });

          // Without invalidation, cache still returns old data.
          const stale = await runtime.runPromise(
            Effect.flatMap(AuthService, (svc) => svc.me()),
          );
          expect(stale.permissions[Resource.PRODUCTS]).toEqual([
            Permission.READ,
          ]);

          // Invalidate on the same RolesService instance (shared runtime).
          await runtime.runPromise(
            Effect.flatMap(RolesService, (svc) => svc.clearAllCache()),
          );

          const fresh = await runtime.runPromise(
            Effect.flatMap(AuthService, (svc) => svc.me()),
          );
          expect(fresh.permissions[Resource.PRODUCTS]).toEqual(
            expect.arrayContaining([Permission.READ, Permission.WRITE]),
          );
        } finally {
          await runtime.dispose();
        }
      }));
  });

  describe('profile', () => {
    it('returns session-derived profile fields without consulting roles tables', () =>
      withRaceRetry(async () => {
        // Seed an unrelated role to prove profile() doesn't touch it.
        await seedRole(db, {
          name: 'Unrelated Role',
          permissions: [
            { resource: Resource.SETTINGS, permission: Permission.READ },
          ],
        });

        const layer = buildAuthServiceLayer(TEST_USER_ID);
        const result = await run(
          Effect.flatMap(AuthService, (svc) => svc.profile()),
          layer,
        );

        expect(result).toEqual({
          id: TEST_USER_ID,
          name: 'Integration Test User',
          email: 'integration@example.com',
          image: undefined,
          createdAt: '2026-03-01T10:00:00.000Z',
          updatedAt: '2026-03-10T12:00:00.000Z',
        });
      }));

    it('fails with SessionUnauthorized when no session is present', async () => {
      const layer = buildAuthServiceLayer(null);
      const error = await runFlip(
        Effect.flatMap(AuthService, (svc) => svc.profile()),
        layer,
      );
      expect(error).toMatchObject({ _tag: 'SessionUnauthorized' });
    });
  });

  describe('sessionClaims', () => {
    it('returns user_id, session_id, and epoch timing from the live session', async () => {
      const layer = buildAuthServiceLayer(TEST_USER_ID);
      const result = await run(
        Effect.flatMap(AuthService, (svc) => svc.sessionClaims()),
        layer,
      );

      expect(result.user_id).toBe(TEST_USER_ID);
      expect(result.session_id).toBe('session-integration');
      // createdAt: 2026-03-10T12:00:00Z -> 1773144000 (epoch seconds)
      expect(result.issued_at).toBe(1773144000);
      // expiresAt: 2026-03-17T12:00:00Z -> 1773748800
      expect(result.expires_at).toBe(1773748800);
    });

    it('fails with SessionUnauthorized when no session is present', async () => {
      const layer = buildAuthServiceLayer(null);
      const error = await runFlip(
        Effect.flatMap(AuthService, (svc) => svc.sessionClaims()),
        layer,
      );
      expect(error).toMatchObject({ _tag: 'SessionUnauthorized' });
    });
  });

  describe('better-auth integration', () => {
    it('forwards incoming request headers to betterAuth.api.getSession', () =>
      withRaceRetry(async () => {
        await seedRoleForUser(db, TEST_USER_ID, {
          name: 'Header Echo Role',
          permissions: [
            { resource: Resource.DASHBOARD, permission: Permission.READ },
          ],
        });

        const getSessionSpy = vi.fn();
        const layer = buildAuthServiceLayer(TEST_USER_ID, {
          getSessionSpy,
          requestHeaders: { authorization: 'Bearer int-token' },
        });

        await run(
          Effect.flatMap(AuthService, (svc) => svc.me()),
          layer,
        );

        expect(getSessionSpy).toHaveBeenCalledTimes(1);
        const callArg = getSessionSpy.mock.calls[0]![0] as {
          headers: globalThis.Headers;
        };
        expect(callArg.headers.get('authorization')).toBe('Bearer int-token');
      }));
  });
});
