/**
 * Integration tests for `UsersService`.
 *
 * Unlike most modules, `UsersService` needs Better Auth's "user of record"
 * data as well as tenant-local role assignments. The user data now flows
 * through repository-backed Better Auth table paths, while role assignments
 * still use local `user_roles` / `roles` persistence. These tests exercise
 * that composition against real Postgres.
 *
 * A fixture (`__fixtures__/seed-users.ts`) provisions a minimal `"user"`
 * table because Better Auth owns that table in production and it is not part
 * of the Drizzle schema pushed by the integration global setup.
 */
import { Effect, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import {
  BetterAuthHeaders,
  TEST_BETTER_AUTH_HEADERS,
  TEST_USER_ID,
  TEST_USER_ID_2,
  closeTestDb,
  getTestDb,
  makeTestDrizzleLayer,
  truncateAll,
} from '../../testing/test-harness';
import { makeBetterAuthTestLayer } from '../../testing/better-auth-test';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { UsersService } from './service';
import {
  ensureBetterAuthUserTable,
  readBetterAuthUserRole,
  seedBetterAuthUserRow,
  seedDefaultTenantMembership,
  seedDefaultTenantMembershipWithoutUser,
  seedRole,
  seedTenantMembership,
  seedTenantUserRow,
} from './__fixtures__/seed-users';

let db: DrizzleDb;
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000002';

const headersLayer = Layer.succeed(BetterAuthHeaders, TEST_BETTER_AUTH_HEADERS);

const makeTestLayer = () =>
  UsersService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        makeTestDrizzleLayer(),
        makeBetterAuthTestLayer({ users: [] }),
        headersLayer,
      ),
    ),
  );

/**
 * `UsersService` method bodies yield `BetterAuthHeaders` at call time, so the
 * per-method effects carry `Headers` in their R-channel even though the
 * service constructor does not require it. Provide it at the run site.
 */
const run = <A, E>(
  effect: Effect.Effect<A, E, UsersService | globalThis.Headers>,
  layer: Layer.Layer<UsersService>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(BetterAuthHeaders, TEST_BETTER_AUTH_HEADERS),
      Effect.provide(layer),
    ),
  );

const fail = <A, E>(
  effect: Effect.Effect<A, E, UsersService | globalThis.Headers>,
  layer: Layer.Layer<UsersService>,
) =>
  Effect.runPromise(
    Effect.flip(
      effect.pipe(
        Effect.provideService(BetterAuthHeaders, TEST_BETTER_AUTH_HEADERS),
        Effect.provide(layer),
      ),
    ),
  );

beforeAll(async () => {
  db = getTestDb();
  await ensureBetterAuthUserTable(db);
});
afterAll(() => closeTestDb());
beforeEach(async () => {
  await truncateAll();
  await ensureBetterAuthUserTable(db);
  await db.execute(
    // Clean `user` rows between tests; `truncateAll` doesn't know about it.
    sql`TRUNCATE TABLE "user" CASCADE`,
  );
});

/**
 * Wave 2 agents run in parallel against a shared test DB. A concurrent
 * `truncateAll()` from another file can wipe our seeded rows mid-test, which
 * surfaces either as a transient Postgres error or a stale-empty assertion.
 * Retry the whole test body a handful of times before giving up. Mirrors the
 * pattern in `auth/service.integration.spec.ts`.
 */
const withRaceRetry = async (
  body: () => Promise<void>,
  attempts = 6,
): Promise<void> => {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      // Re-establish our own pre-conditions: the previous attempt may have
      // left partial state, and truncateAll is only called by vitest between
      // tests, not between retries.
      await truncateAll();
      await ensureBetterAuthUserTable(db);
      await db.execute(sql`TRUNCATE TABLE "user" CASCADE`);
      await body();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20 + i * 30));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const seedTenantUsers = async (
  users: ReadonlyArray<{
    readonly id: string;
    readonly name?: string | null;
    readonly email?: string | null;
  }>,
) => {
  for (const user of users) {
    await seedTenantUserRow(db, user);
  }
};

describe('UsersService Integration', () => {
  describe('listUsers', () => {
    it('merges role names from user_roles into the tenant user list', () =>
      withRaceRetry(async () => {
        const adminRole = await seedRole(db, {
          name: 'Admin',
          is_system: true,
        });
        const pickerRole = await seedRole(db, {
          name: 'Picker',
          is_system: true,
        });

        // User 1 → both roles; User 2 → no roles (exercises the empty-roles merge)
        await db.execute(
          sql`INSERT INTO user_roles (user_id, role_id) VALUES (${TEST_USER_ID}, ${adminRole.id}), (${TEST_USER_ID}, ${pickerRole.id})`,
        );

        const users = [
          { id: TEST_USER_ID, name: 'Admin User' },
          {
            id: TEST_USER_ID_2,
            name: 'No-Roles User',
            email: 'norole@example.com',
          },
        ];
        await seedTenantUsers(users);
        const layer = makeTestLayer();

        const result = await run(
          Effect.flatMap(UsersService, (s) => s.listUsers({})),
          layer,
        );

        expect(result.total).toBe(2);
        expect(result.data).toHaveLength(2);

        const adminUser = result.data.find((u) => u.id === TEST_USER_ID)!;
        const noRolesUser = result.data.find((u) => u.id === TEST_USER_ID_2)!;

        expect(adminUser.name).toBe('Admin User');
        expect(adminUser.roles.sort()).toEqual(['Admin', 'Picker']);
        expect(noRolesUser.roles).toEqual([]);
      }));

    it('returns an empty roles array when the user exists in Better Auth but has no assignments', () =>
      withRaceRetry(async () => {
        const users = [{ id: TEST_USER_ID, name: 'Unassigned' }];
        await seedTenantUsers(users);
        const layer = makeTestLayer();

        const result = await run(
          Effect.flatMap(UsersService, (s) => s.listUsers({})),
          layer,
        );

        expect(result.data).toHaveLength(1);
        expect(result.data[0]!.roles).toEqual([]);
        // The `DEFAULT_PERMISSIONS` fallback lives on the frontend; the
        // backend simply reports an empty role list for users with no
        // assignments.
      }));

    it('paginates results based on `page` + `limit`', () =>
      withRaceRetry(async () => {
        const users = [
          { id: TEST_USER_ID, name: 'Alpha' },
          { id: TEST_USER_ID_2, name: 'Bravo' },
        ];
        await seedTenantUsers(users);
        const layer = makeTestLayer();

        const page1 = await run(
          Effect.flatMap(UsersService, (s) =>
            s.listUsers({ page: 1, limit: 1 }),
          ),
          layer,
        );

        expect(page1.total).toBe(2);
        expect(page1.data).toHaveLength(1);
        expect(page1.total_pages).toBe(2);
        expect(page1.page).toBe(1);
        expect(page1.limit).toBe(1);
      }));

    it('filters by role name after merging assignments', () =>
      withRaceRetry(async () => {
        const sales = await seedRole(db, { name: 'Sales' });
        const picker = await seedRole(db, { name: 'Picker' });

        await db.execute(
          sql`INSERT INTO user_roles (user_id, role_id) VALUES (${TEST_USER_ID}, ${sales.id}), (${TEST_USER_ID_2}, ${picker.id})`,
        );

        const users = [
          { id: TEST_USER_ID, name: 'Sales person' },
          {
            id: TEST_USER_ID_2,
            name: 'Picker person',
          },
        ];
        await seedTenantUsers(users);
        const layer = makeTestLayer();

        const result = await run(
          Effect.flatMap(UsersService, (s) => s.listUsers({ role: 'Sales' })),
          layer,
        );

        expect(result.data).toHaveLength(1);
        expect(result.data[0]!.id).toBe(TEST_USER_ID);
        expect(result.data[0]!.roles).toEqual(['Sales']);
      }));
  });

  describe('getUser', () => {
    it('returns a single user with its role names', () =>
      withRaceRetry(async () => {
        const role = await seedRole(db, { name: 'Warehouse Manager' });
        await db.execute(
          sql`INSERT INTO user_roles (user_id, role_id) VALUES (${TEST_USER_ID}, ${role.id})`,
        );
        await seedTenantUserRow(db, {
          id: TEST_USER_ID,
          name: 'Warehouse Operator',
          email: 'wh@example.com',
        });

        const layer = makeTestLayer();

        const result = await run(
          Effect.flatMap(UsersService, (s) => s.getUser(TEST_USER_ID)),
          layer,
        );

        expect(result.id).toBe(TEST_USER_ID);
        expect(result.roles).toEqual(['Warehouse Manager']);
        expect(result.email).toBe('wh@example.com');
      }));

    it('fails with `UserNotFound` when the Better Auth user table has no such user', () =>
      withRaceRetry(async () => {
        await seedDefaultTenantMembershipWithoutUser(db, TEST_USER_ID);
        const layer = makeTestLayer();

        const error = await fail(
          Effect.flatMap(UsersService, (s) => s.getUser(TEST_USER_ID)),
          layer,
        );

        expect(error._tag).toBe('UserNotFound');
      }));

    it('fails with `UserNotFound` when the user only belongs to another tenant', () =>
      withRaceRetry(async () => {
        await seedBetterAuthUserRow(db, { id: TEST_USER_ID });
        await seedTenantMembership(db, TEST_USER_ID, {
          tenantId: OTHER_TENANT_ID,
          name: 'Other Tenant',
          slug: 'other-tenant',
        });

        const layer = makeTestLayer();

        const error = await fail(
          Effect.flatMap(UsersService, (s) => s.getUser(TEST_USER_ID)),
          layer,
        );

        expect(error._tag).toBe('UserNotFound');
      }));
  });

  describe('updateRoles', () => {
    it('persists role IDs to user_roles and returns the updated user', () =>
      withRaceRetry(async () => {
        const admin = await seedRole(db, { name: 'Admin', is_system: true });
        const sales = await seedRole(db, { name: 'Sales', is_system: true });
        await seedBetterAuthUserRow(db, { id: TEST_USER_ID });
        await seedDefaultTenantMembership(db, TEST_USER_ID);

        const layer = makeTestLayer();

        const result = await run(
          Effect.flatMap(UsersService, (s) =>
            s.updateRoles(TEST_USER_ID, [admin.id, sales.id]),
          ),
          layer,
        );

        expect(result.id).toBe(TEST_USER_ID);
        expect(result.roles.sort()).toEqual(['Admin', 'Sales']);

        // Direct DB assertion: the bridge rows must match exactly.
        const rowsResult = (await db.execute(
          sql`SELECT role_id FROM user_roles WHERE user_id = ${TEST_USER_ID} ORDER BY role_id`,
        )) as unknown as { rows: { role_id: string }[] };
        const persistedIds = rowsResult.rows.map((r) => r.role_id).sort();
        expect(persistedIds).toEqual([admin.id, sales.id].sort());
      }));

    it('replaces the prior assignment set (does not append)', () =>
      withRaceRetry(async () => {
        const admin = await seedRole(db, { name: 'Admin', is_system: true });
        const sales = await seedRole(db, { name: 'Sales', is_system: true });
        const picker = await seedRole(db, {
          name: 'Picker',
          is_system: true,
        });
        await seedBetterAuthUserRow(db, { id: TEST_USER_ID });
        await seedDefaultTenantMembership(db, TEST_USER_ID);

        await db.execute(
          sql`INSERT INTO user_roles (user_id, role_id) VALUES (${TEST_USER_ID}, ${admin.id}), (${TEST_USER_ID}, ${sales.id})`,
        );

        const layer = makeTestLayer();

        const result = await run(
          Effect.flatMap(UsersService, (s) =>
            s.updateRoles(TEST_USER_ID, [picker.id]),
          ),
          layer,
        );

        expect(result.roles).toEqual(['Picker']);

        const rowsResult = (await db.execute(
          sql`SELECT role_id FROM user_roles WHERE user_id = ${TEST_USER_ID}`,
        )) as unknown as { rows: { role_id: string }[] };
        expect(rowsResult.rows.map((r) => r.role_id)).toEqual([picker.id]);
      }));

    it('removes all role assignments when given an empty array', () =>
      withRaceRetry(async () => {
        const admin = await seedRole(db, { name: 'Admin', is_system: true });
        await seedBetterAuthUserRow(db, { id: TEST_USER_ID, role: 'admin' });
        await seedDefaultTenantMembership(db, TEST_USER_ID);

        await db.execute(
          sql`INSERT INTO user_roles (user_id, role_id) VALUES (${TEST_USER_ID}, ${admin.id})`,
        );

        const layer = makeTestLayer();

        const result = await run(
          Effect.flatMap(UsersService, (s) => s.updateRoles(TEST_USER_ID, [])),
          layer,
        );

        expect(result.roles).toEqual([]);

        const rowsResult = (await db.execute(
          sql`SELECT COUNT(*)::int AS count FROM user_roles WHERE user_id = ${TEST_USER_ID}`,
        )) as unknown as { rows: { count: number }[] };
        expect(rowsResult.rows[0]!.count).toBe(0);
      }));

    it('does not elevate the Better Auth `role` column when tenant roles include Admin', () =>
      withRaceRetry(async () => {
        const admin = await seedRole(db, { name: 'Admin', is_system: true });
        await seedBetterAuthUserRow(db, { id: TEST_USER_ID, role: 'user' });
        await seedDefaultTenantMembership(db, TEST_USER_ID);

        const layer = makeTestLayer();

        await run(
          Effect.flatMap(UsersService, (s) =>
            s.updateRoles(TEST_USER_ID, [admin.id]),
          ),
          layer,
        );

        expect(await readBetterAuthUserRole(db, TEST_USER_ID)).toBe('user');
      }));

    it('does not downgrade the Better Auth `role` column when Admin is removed', () =>
      withRaceRetry(async () => {
        const admin = await seedRole(db, { name: 'Admin', is_system: true });
        const sales = await seedRole(db, { name: 'Sales', is_system: true });
        await seedBetterAuthUserRow(db, { id: TEST_USER_ID, role: 'admin' });
        await seedDefaultTenantMembership(db, TEST_USER_ID);

        await db.execute(
          sql`INSERT INTO user_roles (user_id, role_id) VALUES (${TEST_USER_ID}, ${admin.id})`,
        );

        const layer = makeTestLayer();

        await run(
          Effect.flatMap(UsersService, (s) =>
            s.updateRoles(TEST_USER_ID, [sales.id]),
          ),
          layer,
        );

        expect(await readBetterAuthUserRole(db, TEST_USER_ID)).toBe('admin');
      }));

    it('fails with `UserNotFound` when the Better Auth user row is missing (no DB writes occur)', () =>
      withRaceRetry(async () => {
        const admin = await seedRole(db, { name: 'Admin' });
        await seedDefaultTenantMembershipWithoutUser(db, TEST_USER_ID);
        const layer = makeTestLayer();

        const error = await fail(
          Effect.flatMap(UsersService, (s) =>
            s.updateRoles(TEST_USER_ID, [admin.id]),
          ),
          layer,
        );

        expect(error._tag).toBe('UserNotFound');

        const rowsResult = (await db.execute(
          sql`SELECT COUNT(*)::int AS count FROM user_roles WHERE user_id = ${TEST_USER_ID}`,
        )) as unknown as { rows: { count: number }[] };
        expect(rowsResult.rows[0]!.count).toBe(0);
      }));

    it('fails with `UserNotFound` when assigning roles to a user from another tenant', () =>
      withRaceRetry(async () => {
        const admin = await seedRole(db, { name: 'Admin' });
        await seedBetterAuthUserRow(db, { id: TEST_USER_ID });
        await seedTenantMembership(db, TEST_USER_ID, {
          tenantId: OTHER_TENANT_ID,
          name: 'Other Tenant',
          slug: 'other-tenant',
        });

        const layer = makeTestLayer();

        const error = await fail(
          Effect.flatMap(UsersService, (s) =>
            s.updateRoles(TEST_USER_ID, [admin.id]),
          ),
          layer,
        );

        expect(error._tag).toBe('UserNotFound');

        const rowsResult = (await db.execute(
          sql`SELECT COUNT(*)::int AS count FROM user_roles WHERE user_id = ${TEST_USER_ID}`,
        )) as unknown as { rows: { count: number }[] };
        expect(rowsResult.rows[0]!.count).toBe(0);
      }));

    it('keeps Better Auth `role` as admin when the user still has Admin in another tenant', () =>
      withRaceRetry(async () => {
        const currentAdmin = await seedRole(db, {
          name: 'Admin',
          is_system: true,
        });
        const currentSales = await seedRole(db, {
          name: 'Sales',
          is_system: true,
        });
        const otherAdmin = await seedRole(db, {
          name: 'Admin',
          tenant_id: OTHER_TENANT_ID,
          is_system: true,
        });
        await seedBetterAuthUserRow(db, { id: TEST_USER_ID, role: 'admin' });
        await seedDefaultTenantMembership(db, TEST_USER_ID);
        await seedTenantMembership(db, TEST_USER_ID, {
          tenantId: OTHER_TENANT_ID,
          name: 'Other Tenant',
          slug: 'other-tenant',
        });

        await db.execute(sql`
          INSERT INTO user_roles (user_id, tenant_id, role_id)
          VALUES
            (${TEST_USER_ID}, ${currentAdmin.tenant_id}, ${currentAdmin.id}),
            (${TEST_USER_ID}, ${otherAdmin.tenant_id}, ${otherAdmin.id})
        `);

        const layer = makeTestLayer();

        const result = await run(
          Effect.flatMap(UsersService, (s) =>
            s.updateRoles(TEST_USER_ID, [currentSales.id]),
          ),
          layer,
        );

        expect(result.roles).toEqual(['Sales']);
        expect(await readBetterAuthUserRole(db, TEST_USER_ID)).toBe('admin');
      }));

    it('leaves Better Auth `role` unchanged when no tenant keeps an Admin assignment', () =>
      withRaceRetry(async () => {
        const currentAdmin = await seedRole(db, {
          name: 'Admin',
          is_system: true,
        });
        const currentSales = await seedRole(db, {
          name: 'Sales',
          is_system: true,
        });
        const otherSales = await seedRole(db, {
          name: 'Sales',
          tenant_id: OTHER_TENANT_ID,
          is_system: true,
        });
        await seedBetterAuthUserRow(db, { id: TEST_USER_ID, role: 'admin' });
        await seedDefaultTenantMembership(db, TEST_USER_ID);
        await seedTenantMembership(db, TEST_USER_ID, {
          tenantId: OTHER_TENANT_ID,
          name: 'Other Tenant',
          slug: 'other-tenant',
        });

        await db.execute(sql`
          INSERT INTO user_roles (user_id, tenant_id, role_id)
          VALUES
            (${TEST_USER_ID}, ${currentAdmin.tenant_id}, ${currentAdmin.id}),
            (${TEST_USER_ID}, ${otherSales.tenant_id}, ${otherSales.id})
        `);

        const layer = makeTestLayer();

        const result = await run(
          Effect.flatMap(UsersService, (s) =>
            s.updateRoles(TEST_USER_ID, [currentSales.id]),
          ),
          layer,
        );

        expect(result.roles).toEqual(['Sales']);
        expect(await readBetterAuthUserRole(db, TEST_USER_ID)).toBe('admin');
      }));
  });

  describe('deleteUser', () => {
    it('removes tenant state and deletes the Better Auth user row when no memberships remain', () =>
      withRaceRetry(async () => {
        const admin = await seedRole(db, { name: 'Admin' });
        const sales = await seedRole(db, { name: 'Sales' });

        await seedBetterAuthUserRow(db, { id: TEST_USER_ID });
        await seedDefaultTenantMembership(db, TEST_USER_ID);
        await seedBetterAuthUserRow(db, { id: TEST_USER_ID_2 });
        await seedDefaultTenantMembership(db, TEST_USER_ID_2);
        await db.execute(
          sql`INSERT INTO user_roles (user_id, role_id) VALUES (${TEST_USER_ID}, ${admin.id}), (${TEST_USER_ID}, ${sales.id}), (${TEST_USER_ID_2}, ${admin.id})`,
        );

        const layer = makeTestLayer();

        await run(
          Effect.flatMap(UsersService, (s) => s.deleteUser(TEST_USER_ID)),
          layer,
        );

        const userRows = (await db.execute(
          sql`SELECT id FROM "user" WHERE id = ${TEST_USER_ID}`,
        )) as unknown as { rows: { id: string }[] };
        expect(userRows.rows).toEqual([]);

        // Target user's roles cleared; unrelated user's row untouched.
        const rowsResult = (await db.execute(
          sql`SELECT user_id FROM user_roles WHERE user_id IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
        )) as unknown as { rows: { user_id: string }[] };
        const remainingUserIds = rowsResult.rows.map((r) => r.user_id);
        expect(remainingUserIds).toEqual([TEST_USER_ID_2]);
      }));

    it('removes only current-tenant state and preserves the Better Auth user row when other memberships remain', () =>
      withRaceRetry(async () => {
        const currentRole = await seedRole(db, { name: 'Current Tenant Role' });
        await seedBetterAuthUserRow(db, {
          id: TEST_USER_ID,
          name: 'Multi Tenant User',
        });
        await seedDefaultTenantMembership(db, TEST_USER_ID);
        await seedTenantMembership(db, TEST_USER_ID, {
          tenantId: OTHER_TENANT_ID,
          name: 'Other Tenant',
          slug: 'other-tenant',
        });
        const otherRole = await seedRole(db, {
          name: 'Other Tenant Role',
          tenant_id: OTHER_TENANT_ID,
        });
        await db.execute(sql`
          INSERT INTO user_roles (user_id, tenant_id, role_id)
          VALUES
            (${TEST_USER_ID}, ${currentRole.tenant_id}, ${currentRole.id}),
            (${TEST_USER_ID}, ${otherRole.tenant_id}, ${otherRole.id})
        `);

        const layer = makeTestLayer();

        await run(
          Effect.flatMap(UsersService, (s) => s.deleteUser(TEST_USER_ID)),
          layer,
        );

        const userRows = (await db.execute(
          sql`SELECT id FROM "user" WHERE id = ${TEST_USER_ID}`,
        )) as unknown as { rows: { id: string }[] };
        expect(userRows.rows).toEqual([{ id: TEST_USER_ID }]);

        const membershipRows = (await db.execute(
          sql`SELECT organization_id FROM member WHERE user_id = ${TEST_USER_ID}`,
        )) as unknown as { rows: { organization_id: string }[] };
        expect(membershipRows.rows).toEqual([
          { organization_id: OTHER_TENANT_ID },
        ]);

        const roleRows = (await db.execute(
          sql`SELECT tenant_id, role_id FROM user_roles WHERE user_id = ${TEST_USER_ID}`,
        )) as unknown as { rows: { tenant_id: string; role_id: string }[] };
        expect(roleRows.rows).toEqual([
          { tenant_id: OTHER_TENANT_ID, role_id: otherRole.id },
        ]);
      }));
  });
});
