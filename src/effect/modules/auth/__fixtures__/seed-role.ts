/**
 * Integration-test fixture helpers for the `auth` module.
 *
 * These live under the module's `__fixtures__/` directory (not the shared
 * `test/seed.ts`) because they're only needed by auth-adjacent specs that
 * need to populate the role-graph tables (`roles`, `role_permissions`,
 * `user_roles`) by hand.
 */
import { and, eq } from 'drizzle-orm';
import type { Permission, Resource } from '@stocket/types/auth';
import {
  members,
  organizations,
  roles,
  rolePermissions,
  userRoles,
} from '../../../platform/db/schema';
import type { DrizzleDb } from '../../../platform/db/drizzle';
import { seedBetterAuthUser } from '../../../test/seed';
import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_NAME,
  DEFAULT_TENANT_SLUG,
} from '../../../platform/tenancy/tenant-constants';

export interface SeedRoleInput {
  readonly name: string;
  readonly description?: string;
  readonly is_system?: boolean;
  readonly permissions?: ReadonlyArray<{
    readonly resource: Resource;
    readonly permission: Permission;
  }>;
}

const getPgErrorCode = (e: unknown): string | undefined => {
  if (!e || typeof e !== 'object') return undefined;
  const maybePgError = e as { code?: unknown; cause?: unknown };
  if (typeof maybePgError.code === 'string') return maybePgError.code;
  return getPgErrorCode(maybePgError.cause);
};

const isTransientPgError = (e: unknown): boolean => {
  const code = getPgErrorCode(e);
  // 23503 = FK violation (another wave just truncated after our parent insert)
  // 40P01 = deadlock (TRUNCATE racing us for AccessExclusiveLock)
  // 40001 = serialization failure
  return code === '23503' || code === '40P01' || code === '40001';
};

const retryOnTransient = async <A>(
  op: () => Promise<A>,
  label: string,
  attempts = 8,
): Promise<A> => {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await op();
    } catch (error) {
      lastError = error;
      if (!isTransientPgError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10 + i * 25));
    }
  }
  throw new Error(
    `${label}: giving up after ${attempts} transient PG error(s); last=${String(lastError)}`,
  );
};

/**
 * Ensure a role row with this name exists, re-inserting it if a concurrent
 * TRUNCATE wiped it. Returns the row's id.
 */
const upsertRole = async (
  db: DrizzleDb,
  input: SeedRoleInput,
): Promise<string> => {
  // Try a plain insert first. If the tenant-local name is already present
  // (23505 unique) from a previous retry iteration, look it up. If the roles table got
  // truncated between two operations, the next caller will just re-insert.
  try {
    const [row] = await db
      .insert(roles)
      .values({
        tenant_id: DEFAULT_TENANT_ID,
        name: input.name,
        description: input.description ?? null,
        is_system: input.is_system ?? false,
      })
      .returning({ id: roles.id });
    if (!row) throw new Error(`upsertRole: insert returned no row`);
    return row.id;
  } catch (error) {
    const code = getPgErrorCode(error);
    if (code !== '23505') throw error;
    // Unique violation — someone else (or a previous retry) already inserted
    // the row. Resolve the id by tenant-local name.
    const rows = await db
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(eq(roles.tenant_id, DEFAULT_TENANT_ID), eq(roles.name, input.name)),
      )
      .limit(1);
    if (!rows[0]) {
      const err = new Error(
        `upsertRole: unique violation on "${input.name}" but row not present on lookup`,
      );
      (err as unknown as { code: string }).code = '23503';
      throw err;
    }
    return rows[0].id;
  }
};

export async function seedDefaultTenantMembership(
  db: DrizzleDb,
  userId: string,
): Promise<void> {
  await retryOnTransient(async () => {
    await seedBetterAuthUser(db, { id: userId });
    await db
      .insert(organizations)
      .values({
        id: DEFAULT_TENANT_ID,
        name: DEFAULT_TENANT_NAME,
        slug: DEFAULT_TENANT_SLUG,
      })
      .onConflictDoNothing();
    await db
      .insert(members)
      .values({
        id: `${DEFAULT_TENANT_ID}:${userId}`,
        organization_id: DEFAULT_TENANT_ID,
        user_id: userId,
        role: 'member',
      })
      .onConflictDoNothing();
  }, 'seedDefaultTenantMembership');
}

/**
 * Insert a role and its permissions directly, bypassing `RolesService`.
 *
 * Each individual insert is retried on transient FK/deadlock errors caused by
 * other Wave-2 agents sharing the test DB and running `TRUNCATE ... CASCADE`
 * in their `beforeEach`. We deliberately do NOT wrap the inserts in a single
 * transaction — holding `RowExclusiveLock` on `roles` across multiple
 * statements deadlocks with a concurrent wave's `TRUNCATE`
 * (`AccessExclusiveLock`). The `upsertRole` path makes each retry idempotent
 * under the roles-table unique name constraint.
 */
export async function seedRole(
  db: DrizzleDb,
  input: SeedRoleInput,
): Promise<{ id: string; name: string }> {
  let roleId = await retryOnTransient(
    () => upsertRole(db, input),
    'seedRole.role',
  );

  if (input.permissions && input.permissions.length > 0) {
    await retryOnTransient(async () => {
      // Verify the role still exists (another wave may have truncated) — if
      // gone, re-insert it. This makes the FK violation self-healing.
      const existing = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);
      const targetId = existing[0]?.id ?? (await upsertRole(db, input));
      roleId = targetId;

      await db
        .insert(rolePermissions)
        .values(
          input.permissions!.map((p) => ({
            role_id: targetId,
            resource: p.resource,
            permission: p.permission,
          })),
        )
        .onConflictDoNothing();
    }, 'seedRole.permissions');
  }

  return { id: roleId, name: input.name };
}

/**
 * Assign a role to a user via the `user_roles` bridge table, retrying on
 * transient FK violations caused by concurrent truncates.
 */
export async function assignRoleToUser(
  db: DrizzleDb,
  userId: string,
  roleId: string,
): Promise<void> {
  await retryOnTransient(async () => {
    await db
      .insert(userRoles)
      .values({
        tenant_id: DEFAULT_TENANT_ID,
        user_id: userId,
        role_id: roleId,
      })
      .onConflictDoNothing();
  }, 'assignRoleToUser');
}

/**
 * Seed a role AND assign it to `userId`.
 *
 * Implemented as sequential single-statement inserts (no transaction) with
 * retry-on-transient-FK — see `seedRole` for the rationale against a
 * top-level `BEGIN ... COMMIT`. The whole chain is wrapped in one retry
 * loop so any intermediate truncation by a concurrent wave agent re-runs
 * from scratch (via the `upsertRole` idempotent re-insert).
 */
export async function seedRoleForUser(
  db: DrizzleDb,
  userId: string,
  input: SeedRoleInput,
): Promise<{ id: string; name: string }> {
  return retryOnTransient(async () => {
    await seedDefaultTenantMembership(db, userId);
    const roleId = await upsertRole(db, input);

    if (input.permissions && input.permissions.length > 0) {
      await db
        .insert(rolePermissions)
        .values(
          input.permissions.map((p) => ({
            role_id: roleId,
            resource: p.resource,
            permission: p.permission,
          })),
        )
        .onConflictDoNothing();
    }

    await db
      .insert(userRoles)
      .values({
        tenant_id: DEFAULT_TENANT_ID,
        user_id: userId,
        role_id: roleId,
      })
      .onConflictDoNothing();

    return { id: roleId, name: input.name };
  }, 'seedRoleForUser');
}
