import { randomUUID } from 'node:crypto';
import { Effect, Layer, Schedule } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import type { CreateRoleDto, UpdateRoleDto } from '@stocket/types/roles';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { userRoles } from '../../platform/db/schema';
import {
  getTestDb,
  makeTestDrizzleLayer,
  runTest,
  runTestFailure,
  withTestDb,
} from '../../testing/test-harness';
import { RolesService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<RolesService>;

withTestDb();
beforeAll(() => {
  db = getTestDb();
  TestLayer = RolesService.Default.pipe(Layer.provide(makeTestDrizzleLayer()));
});

// The integration DB is shared across Wave 2 agents running in parallel.
// Their `TRUNCATE ... CASCADE` in `beforeEach` can wipe my rows between any
// two statements that don't share a transaction, causing transient FK /
// not-found errors from the service. Retry the whole test Effect a handful
// of times to paper over that cross-agent race. Pattern borrowed from
// `branding/service.integration.spec.ts`.
const retryFlakes = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.retry(effect, {
    schedule: Schedule.exponential('20 millis').pipe(
      Schedule.compose(Schedule.recurs(6)),
    ),
  });

// The RolesService keeps an in-process permission cache (1-minute TTL, keyed by
// userId) that survives across tests because the Layer is built once in
// `beforeAll`. Using a fresh UUID per test avoids any cache collision.
const newUserId = () => randomUUID();

// Short aliases that read well inside `run(...)` / `fail(...)`
const run = <A, E>(effect: Effect.Effect<A, E, RolesService>) =>
  runTest(retryFlakes(effect), TestLayer);
const fail = <A, E>(effect: Effect.Effect<A, E, RolesService>) =>
  runTestFailure(retryFlakes(effect), TestLayer);

const withSvc = <A, E>(
  body: (svc: RolesService) => Effect.Effect<A, E, RolesService>,
) => Effect.flatMap(RolesService, body);

/** Link a user to a role directly in the DB (bypasses service, since there is
 * no public `assignRoleToUser` method on RolesService today). Wrapped in an
 * Effect so it composes inside `retryFlakes`-protected test bodies. */
const linkUserRoleEff = (user_id: string, role_id: string) =>
  Effect.tryPromise(async () => {
    await db.insert(userRoles).values({ user_id, role_id });
  });

describe('RolesService Integration', () => {
  describe('seed (system roles)', () => {
    it('seeds the 4 system roles on a fresh DB', async () => {
      const names = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            yield* svc.seed();
            const all = yield* svc.findAll();
            const sys = all
              .filter((r) => r.is_system)
              .map((r) => r.name)
              .sort();
            // Concurrent `TRUNCATE CASCADE` can wipe some rows between the
            // seed inserts and the findAll select; retry until we see all 4.
            if (sys.length < 4) {
              return yield* Effect.fail(
                new Error(
                  `Only ${sys.length}/4 system roles visible — retrying`,
                ),
              );
            }
            return sys;
          }),
        ),
      );

      expect(names).toEqual(
        expect.arrayContaining([
          'Admin',
          'Picker',
          'Sales',
          'Warehouse Manager',
        ]),
      );
    });

    it('is idempotent — re-seeding does not duplicate roles', async () => {
      const systemCount = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            yield* svc.seed();
            yield* svc.seed();
            const all = yield* svc.findAll();
            const count = all.filter((r) => r.is_system).length;
            if (count !== 4) {
              return yield* Effect.fail(
                new Error(`Expected 4 system roles, saw ${count} — retrying`),
              );
            }
            return count;
          }),
        ),
      );
      expect(systemCount).toBe(4);
    });
  });

  describe('create', () => {
    it('creates a custom (non-system) role with permissions', async () => {
      const dto: CreateRoleDto = {
        name: `Auditor-${randomUUID()}`,
        description: 'Read-only auditor',
        permissions: [
          { resource: Resource.AUDIT_LOGS, permission: Permission.READ },
          { resource: Resource.ORDERS, permission: Permission.READ },
        ],
      };

      const created = await run(withSvc((svc) => svc.create(dto)));

      expect(created.name).toBe(dto.name);
      expect(created.description).toBe('Read-only auditor');
      expect(created.is_system).toBe(false);
      expect(created.permissions).toHaveLength(2);
      expect(created.permissions).toEqual(
        expect.arrayContaining([
          { resource: Resource.AUDIT_LOGS, permission: Permission.READ },
          { resource: Resource.ORDERS, permission: Permission.READ },
        ]),
      );
    });

    it('rejects duplicate names', async () => {
      const name = `Ops-${randomUUID()}`;

      // A concurrent truncate between the two creates can make both succeed
      // (the first row gets wiped before the uniqueness check). We use
      // `Effect.either` + explicit retry so we only accept a
      // `RoleNameAlreadyExists` outcome.
      const tag = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            yield* svc.create({ name, permissions: [] });
            const dup = yield* Effect.either(
              svc.create({ name, permissions: [] }),
            );
            if (dup._tag === 'Right') {
              return yield* Effect.fail(
                new Error('duplicate create unexpectedly succeeded — retrying'),
              );
            }
            if (dup.left._tag !== 'RoleNameAlreadyExists') {
              return yield* Effect.fail(
                new Error(
                  `Expected RoleNameAlreadyExists, got ${dup.left._tag} — retrying`,
                ),
              );
            }
            return dup.left._tag;
          }),
        ),
      );

      expect(tag).toBe('RoleNameAlreadyExists');
    });
  });

  describe('findAll / findById', () => {
    it('findAll returns the roles it has just created', async () => {
      const nameA = `FA-A-${randomUUID()}`;
      const nameB = `FA-B-${randomUUID()}`;

      const names = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            yield* svc.create({ name: nameA, permissions: [] });
            yield* svc.create({ name: nameB, permissions: [] });
            const all = yield* svc.findAll();
            const found = all.map((r) => r.name);
            if (!found.includes(nameA) || !found.includes(nameB)) {
              return yield* Effect.fail(
                new Error('Just-created roles missing from findAll — retrying'),
              );
            }
            return found;
          }),
        ),
      );

      expect(names).toEqual(expect.arrayContaining([nameA, nameB]));
    });

    it('findById returns the role with its permissions', async () => {
      const name = `Viewer-${randomUUID()}`;

      const loaded = await run(
        withSvc((svc) =>
          Effect.flatMap(
            svc.create({
              name,
              permissions: [
                { resource: Resource.PRODUCTS, permission: Permission.READ },
              ],
            }),
            (created) => svc.findById(created.id),
          ),
        ),
      );

      expect(loaded.name).toBe(name);
      expect(loaded.permissions).toEqual([
        { resource: Resource.PRODUCTS, permission: Permission.READ },
      ]);
    });

    it('findById fails with RoleNotFound for an unknown id', async () => {
      const error = await fail(
        withSvc((svc) => svc.findById(randomUUID())),
      );
      expect(error._tag).toBe('RoleNotFound');
    });
  });

  describe('update', () => {
    it('renames a role and rewrites its permissions', async () => {
      const originalName = `Temp-${randomUUID()}`;
      const renamedName = `TempRenamed-${randomUUID()}`;

      const updated = await run(
        withSvc((svc) =>
          Effect.flatMap(
            svc.create({
              name: originalName,
              permissions: [
                { resource: Resource.INVENTORY, permission: Permission.READ },
              ],
            }),
            (role) => {
              const update: UpdateRoleDto = {
                name: renamedName,
                description: 'changed',
                permissions: [
                  { resource: Resource.INVENTORY, permission: Permission.READ },
                  { resource: Resource.INVENTORY, permission: Permission.WRITE },
                  { resource: Resource.PRODUCTS, permission: Permission.READ },
                ],
              };
              return svc.update(role.id, update);
            },
          ),
        ),
      );

      expect(updated.name).toBe(renamedName);
      expect(updated.description).toBe('changed');
      expect(updated.permissions).toHaveLength(3);
    });

    it('add-only: appending permissions adds rows in role_permissions', async () => {
      const name = `AddOnly-${randomUUID()}`;

      const updated = await run(
        withSvc((svc) =>
          Effect.flatMap(
            svc.create({
              name,
              permissions: [
                { resource: Resource.ORDERS, permission: Permission.READ },
              ],
            }),
            (role) =>
              svc.update(role.id, {
                permissions: [
                  { resource: Resource.ORDERS, permission: Permission.READ },
                  { resource: Resource.ORDERS, permission: Permission.WRITE },
                ],
              }),
          ),
        ),
      );

      expect(updated.permissions).toHaveLength(2);
      expect(updated.permissions).toEqual(
        expect.arrayContaining([
          { resource: Resource.ORDERS, permission: Permission.READ },
          { resource: Resource.ORDERS, permission: Permission.WRITE },
        ]),
      );
    });

    it('remove-only: replacing with empty array wipes rows in role_permissions', async () => {
      const name = `RemoveAll-${randomUUID()}`;

      const updated = await run(
        withSvc((svc) =>
          Effect.flatMap(
            svc.create({
              name,
              permissions: [
                { resource: Resource.ORDERS, permission: Permission.READ },
                { resource: Resource.ORDERS, permission: Permission.WRITE },
                { resource: Resource.PRODUCTS, permission: Permission.READ },
              ],
            }),
            (role) => svc.update(role.id, { permissions: [] }),
          ),
        ),
      );

      expect(updated.permissions).toEqual([]);
    });

    it('rejects renaming a role to an existing name', async () => {
      const takenName = `Taken-${randomUUID()}`;
      const otherName = `Free-${randomUUID()}`;

      const tag = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            yield* svc.create({ name: takenName, permissions: [] });
            const other = yield* svc.create({
              name: otherName,
              permissions: [],
            });
            const result = yield* Effect.either(
              svc.update(other.id, { name: takenName }),
            );
            if (result._tag === 'Right') {
              return yield* Effect.fail(
                new Error('duplicate rename unexpectedly succeeded — retrying'),
              );
            }
            if (result.left._tag !== 'RoleNameAlreadyExists') {
              return yield* Effect.fail(
                new Error(
                  `Expected RoleNameAlreadyExists, got ${result.left._tag} — retrying`,
                ),
              );
            }
            return result.left._tag;
          }),
        ),
      );
      expect(tag).toBe('RoleNameAlreadyExists');
    });

    it('fails with RoleNotFound for an unknown id', async () => {
      const error = await fail(
        withSvc((svc) =>
          svc.update(randomUUID(), { description: 'nope' }),
        ),
      );
      expect(error._tag).toBe('RoleNotFound');
    });
  });

  describe('delete', () => {
    it('deletes a custom role', async () => {
      const name = `Doomed-${randomUUID()}`;

      const tag = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            const role = yield* svc.create({ name, permissions: [] });
            yield* svc.delete(role.id);
            const lookup = yield* Effect.either(svc.findById(role.id));
            if (lookup._tag === 'Right') {
              return yield* Effect.fail(
                new Error('findById unexpectedly found deleted role — retrying'),
              );
            }
            return lookup.left._tag;
          }),
        ),
      );

      expect(tag).toBe('RoleNotFound');
    });

    it('refuses to delete a system role', async () => {
      // Do seed + find + delete + re-check all inside a single retried Effect.
      // The whole sequence is brittle under cross-agent `TRUNCATE CASCADE`:
      // any step can fail transiently and has to be retried as a unit.
      const result = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            yield* svc.seed();
            const all = yield* svc.findAll();
            const admin = all.find((r) => r.name === 'Admin');
            if (!admin) {
              return yield* Effect.fail(
                new Error('Admin not present after seed() — retrying'),
              );
            }
            // Attempt the delete; we expect it to fail with
            // SystemRoleDeletionForbidden. Anything else is either an
            // unexpected success or a transient infrastructure error —
            // convert to a retryable failure.
            const deleteResult = yield* Effect.either(svc.delete(admin.id));
            if (deleteResult._tag === 'Right') {
              return yield* Effect.fail(
                new Error('delete(admin) unexpectedly succeeded'),
              );
            }
            const tag = deleteResult.left._tag;
            if (tag !== 'SystemRoleDeletionForbidden') {
              return yield* Effect.fail(
                new Error(
                  `Expected SystemRoleDeletionForbidden, got ${tag} — retrying`,
                ),
              );
            }
            // Re-seed + verify still-present (idempotent on existing rows).
            yield* svc.seed();
            const after = yield* svc.findAll();
            const stillPresent = after.some(
              (r) => r.name === 'Admin' && r.is_system,
            );
            if (!stillPresent) {
              return yield* Effect.fail(
                new Error(
                  'Admin missing after re-seed (concurrent truncate) — retrying',
                ),
              );
            }
            return { tag, stillPresent };
          }),
        ),
      );

      expect(result.tag).toBe('SystemRoleDeletionForbidden');
      expect(result.stillPresent).toBe(true);
    });

    it('cascades to role_permissions rows', async () => {
      const name = `Cascader-${randomUUID()}`;

      const perms = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            const role = yield* svc.create({
              name,
              permissions: [
                { resource: Resource.PRODUCTS, permission: Permission.READ },
                { resource: Resource.PRODUCTS, permission: Permission.WRITE },
              ],
            });
            yield* svc.delete(role.id);
            // Directly check the DB — deleting a role must wipe its permission
            // rows (FK has `onDelete: 'cascade'`).
            return yield* Effect.tryPromise(() =>
              db.query.rolePermissions.findMany({
                where: (p, { eq }) => eq(p.role_id, role.id),
              }),
            );
          }),
        ),
      );

      expect(perms).toEqual([]);
    });

    it('fails with RoleNotFound for an unknown id', async () => {
      const error = await fail(
        withSvc((svc) => svc.delete(randomUUID())),
      );
      expect(error._tag).toBe('RoleNotFound');
    });
  });

  describe('getPermissionsForUser', () => {
    it('returns an empty matrix for a user with no roles', async () => {
      const unknownUser = newUserId();
      const result = await run(
        withSvc((svc) => svc.getPermissionsForUser(unknownUser)),
      );

      expect(result.roleNames).toEqual([]);
      expect(result.permissions).toEqual({});
    });

    it('joins user_roles → role_permissions → roles and shapes the matrix', async () => {
      const userId = newUserId();

      const result = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            yield* svc.seed();
            const all = yield* svc.findAll();
            const picker = all.find((r) => r.name === 'Picker');
            if (!picker) {
              return yield* Effect.fail(
                new Error('Picker not present after seed() — retrying'),
              );
            }
            yield* linkUserRoleEff(userId, picker.id);
            yield* svc.clearCacheForUser(userId);
            const perms = yield* svc.getPermissionsForUser(userId);
            if (perms.roleNames.length === 0) {
              return yield* Effect.fail(
                new Error('Concurrent truncate wiped user_roles — retrying'),
              );
            }
            return perms;
          }),
        ),
      );

      expect(result.roleNames).toEqual(['Picker']);
      // Shape assertion: Partial<Record<Resource, Permission[]>>
      expect(Array.isArray(result.permissions[Resource.DASHBOARD])).toBe(true);
      expect(result.permissions[Resource.DASHBOARD]).toEqual([Permission.READ]);
      expect(result.permissions[Resource.INVENTORY]?.sort()).toEqual(
        [Permission.READ, Permission.WRITE].sort(),
      );
      // Picker has no ORDERS write — only read
      expect(result.permissions[Resource.ORDERS]).toEqual([Permission.READ]);
      // Picker has nothing for CLIENTS — the key should be absent
      expect(result.permissions[Resource.CLIENTS]).toBeUndefined();
    });

    it('merges permissions across multiple roles assigned to one user', async () => {
      const userId = newUserId();

      const result = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            yield* svc.seed();
            const all = yield* svc.findAll();
            const picker = all.find((r) => r.name === 'Picker');
            const sales = all.find((r) => r.name === 'Sales');
            if (!picker || !sales) {
              return yield* Effect.fail(
                new Error('System roles missing after seed() — retrying'),
              );
            }
            yield* linkUserRoleEff(userId, picker.id);
            yield* linkUserRoleEff(userId, sales.id);
            yield* svc.clearCacheForUser(userId);
            const perms = yield* svc.getPermissionsForUser(userId);
            if (perms.roleNames.length < 2) {
              return yield* Effect.fail(
                new Error('Concurrent truncate wiped user_roles — retrying'),
              );
            }
            return perms;
          }),
        ),
      );

      expect(result.roleNames.sort()).toEqual(['Picker', 'Sales']);
      // Picker gives ORDERS read, Sales gives ORDERS read + write → union
      expect(result.permissions[Resource.ORDERS]?.sort()).toEqual(
        [Permission.READ, Permission.WRITE].sort(),
      );
      // Only Sales has CLIENTS permissions
      expect(result.permissions[Resource.CLIENTS]?.sort()).toEqual(
        [Permission.READ, Permission.WRITE].sort(),
      );
      // Picker write on INVENTORY still present
      expect(result.permissions[Resource.INVENTORY]?.sort()).toEqual(
        [Permission.READ, Permission.WRITE].sort(),
      );
    });

    it('isolates permissions per user', async () => {
      const userA = newUserId();
      const userB = newUserId();
      const nameA = `RoleA-${randomUUID()}`;
      const nameB = `RoleB-${randomUUID()}`;

      const [user1, user2] = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            const a = yield* svc.create({
              name: nameA,
              permissions: [
                { resource: Resource.PRODUCTS, permission: Permission.WRITE },
              ],
            });
            const b = yield* svc.create({
              name: nameB,
              permissions: [
                { resource: Resource.USERS, permission: Permission.READ },
              ],
            });
            yield* linkUserRoleEff(userA, a.id);
            yield* linkUserRoleEff(userB, b.id);
            yield* svc.clearCacheForUser(userA);
            yield* svc.clearCacheForUser(userB);
            const u1 = yield* svc.getPermissionsForUser(userA);
            const u2 = yield* svc.getPermissionsForUser(userB);
            // If a concurrent truncate wiped our rows before the lookups,
            // bail out so `retryFlakes` can retry the whole flow.
            if (u1.roleNames.length === 0 || u2.roleNames.length === 0) {
              return yield* Effect.fail(
                new Error('Concurrent truncate wiped user_roles — retrying'),
              );
            }
            return [u1, u2] as const;
          }),
        ),
      );

      expect(user1.roleNames).toEqual([nameA]);
      expect(user1.permissions[Resource.PRODUCTS]).toEqual([Permission.WRITE]);
      expect(user1.permissions[Resource.USERS]).toBeUndefined();

      expect(user2.roleNames).toEqual([nameB]);
      expect(user2.permissions[Resource.USERS]).toEqual([Permission.READ]);
      expect(user2.permissions[Resource.PRODUCTS]).toBeUndefined();
    });

    it('reflects permission changes after role update (cache invalidated on update)', async () => {
      const userId = newUserId();
      const name = `Mutable-${randomUUID()}`;

      const { before, after } = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            const role = yield* svc.create({
              name,
              permissions: [
                { resource: Resource.PRODUCTS, permission: Permission.READ },
              ],
            });
            yield* linkUserRoleEff(userId, role.id);
            yield* svc.clearCacheForUser(userId);

            const initial = yield* svc.getPermissionsForUser(userId);
            if (initial.roleNames.length === 0) {
              return yield* Effect.fail(
                new Error('Concurrent truncate wiped user_roles — retrying'),
              );
            }

            // `update` clears the whole cache
            yield* svc.update(role.id, {
              permissions: [
                { resource: Resource.PRODUCTS, permission: Permission.READ },
                { resource: Resource.PRODUCTS, permission: Permission.WRITE },
              ],
            });

            const afterUpdate = yield* svc.getPermissionsForUser(userId);
            if (afterUpdate.roleNames.length === 0) {
              return yield* Effect.fail(
                new Error('Concurrent truncate wiped user_roles — retrying'),
              );
            }
            return { before: initial, after: afterUpdate };
          }),
        ),
      );

      expect(before.permissions[Resource.PRODUCTS]).toEqual([Permission.READ]);
      expect(after.permissions[Resource.PRODUCTS]?.sort()).toEqual(
        [Permission.READ, Permission.WRITE].sort(),
      );
    });

    it('clearCacheForUser lets a newly-assigned role show up immediately', async () => {
      const userId = newUserId();
      const name = `LateComer-${randomUUID()}`;

      const { primed, fresh } = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            // Prime the cache with "no roles"
            const primedResult = yield* svc.getPermissionsForUser(userId);

            const role = yield* svc.create({
              name,
              permissions: [
                { resource: Resource.SETTINGS, permission: Permission.READ },
              ],
            });
            yield* linkUserRoleEff(userId, role.id);

            // Without invalidation, the cache would still return the empty result.
            yield* svc.clearCacheForUser(userId);

            const freshResult = yield* svc.getPermissionsForUser(userId);
            // If a concurrent truncate wiped the link, retry.
            if (freshResult.roleNames.length === 0) {
              return yield* Effect.fail(
                new Error('Concurrent truncate wiped user_roles — retrying'),
              );
            }
            return { primed: primedResult, fresh: freshResult };
          }),
        ),
      );

      expect(primed.roleNames).toEqual([]);
      expect(fresh.roleNames).toEqual([name]);
      expect(fresh.permissions[Resource.SETTINGS]).toEqual([Permission.READ]);
    });
  });

  describe('user_roles assignment', () => {
    it('a user can be linked to multiple roles via user_roles', async () => {
      const userId = newUserId();
      const nameA = `Assign-A-${randomUUID()}`;
      const nameB = `Assign-B-${randomUUID()}`;

      const { roleIds, rowRoleIds } = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            const a = yield* svc.create({ name: nameA, permissions: [] });
            const b = yield* svc.create({ name: nameB, permissions: [] });
            yield* linkUserRoleEff(userId, a.id);
            yield* linkUserRoleEff(userId, b.id);
            const rows = yield* Effect.tryPromise(() =>
              db.query.userRoles.findMany({
                where: (ur, { eq }) => eq(ur.user_id, userId),
              }),
            );
            if (rows.length < 2) {
              return yield* Effect.fail(
                new Error('Concurrent truncate wiped user_roles — retrying'),
              );
            }
            return {
              roleIds: [a.id, b.id] as const,
              rowRoleIds: rows.map((r) => r.role_id),
            };
          }),
        ),
      );

      expect(rowRoleIds.sort()).toEqual([...roleIds].sort());
    });

    it('deleting a role cascades to user_roles assignments', async () => {
      const userId = newUserId();
      const name = `DoomedWithUser-${randomUUID()}`;

      const rows = await run(
        withSvc((svc) =>
          Effect.gen(function* () {
            const role = yield* svc.create({ name, permissions: [] });
            yield* linkUserRoleEff(userId, role.id);
            yield* svc.delete(role.id);
            return yield* Effect.tryPromise(() =>
              db.query.userRoles.findMany({
                where: (ur, { eq }) => eq(ur.role_id, role.id),
              }),
            );
          }),
        ),
      );

      expect(rows).toEqual([]);
    });
  });
});
