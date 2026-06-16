/**
 * Fixtures for the `UsersService` integration test.
 *
 * `UsersService` reads and mutates Better Auth's local tables through
 * `UsersRepository` while tenant membership and role assignments remain in
 * Stocket tables. Better Auth owns the `user`, `account`, and `session`
 * tables in production, so this fixture provisions a minimal compatible shape
 * for integration tests.
 *
 * Similarly, the `roles` table is truncated between tests but not seeded, so
 * `seedRole` inserts rows we can reference from `updateRoles` calls.
 */
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { DrizzleDb } from '../../../platform/db/drizzle';
import { members, organizations, roles } from '../../../platform/db/schema';
import {
  ensureBetterAuthUserTable as ensureSharedBetterAuthUserTable,
  seedBetterAuthUser,
} from '../../../testing/seed';
import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_NAME,
  DEFAULT_TENANT_SLUG,
} from '../../../platform/tenancy/tenant-constants';

/**
 * Create stand-ins for Better Auth tables if the schema push did not provision
 * them. The shared fixture includes the columns exercised by repository-backed
 * user lookup, delete, session revocation, and ban/unban flows.
 *
 * Idempotent: safe to call on every test-suite bootstrap.
 */
export async function ensureBetterAuthUserTable(db: DrizzleDb): Promise<void> {
  await ensureSharedBetterAuthUserTable(db);
}

/**
 * Insert a Better Auth `user` row so repository-backed service methods can
 * read and mutate the same local auth table shape used at runtime.
 */
export async function seedBetterAuthUserRow(
  db: DrizzleDb,
  overrides: {
    id: string;
    name?: string;
    email?: string;
    role?: 'admin' | 'user';
  },
): Promise<void> {
  await seedBetterAuthUser(db, overrides);
}

type TenantSeed = {
  readonly tenantId: string;
  readonly name?: string;
  readonly slug?: string;
};

const defaultTenantSeed: TenantSeed = {
  tenantId: DEFAULT_TENANT_ID,
  name: DEFAULT_TENANT_NAME,
  slug: DEFAULT_TENANT_SLUG,
};

async function seedTenantOrganization(
  db: DrizzleDb,
  tenant: TenantSeed,
): Promise<void> {
  await db
    .insert(organizations)
    .values({
      id: tenant.tenantId,
      name: tenant.name ?? `Tenant ${tenant.tenantId}`,
      slug: tenant.slug ?? `tenant-${tenant.tenantId}`,
    })
    .onConflictDoNothing();
}

async function seedTenantMembershipRow(
  db: DrizzleDb,
  userId: string,
  tenant: TenantSeed,
): Promise<void> {
  await seedTenantOrganization(db, tenant);
  await db
    .insert(members)
    .values({
      id: randomUUID(),
      organization_id: tenant.tenantId,
      user_id: userId,
      role: 'member',
    })
    .onConflictDoNothing();
}

export async function seedDefaultTenantMembership(
  db: DrizzleDb,
  userId: string,
): Promise<void> {
  await seedTenantMembership(db, userId, defaultTenantSeed);
}

export async function seedDefaultTenantMembershipWithoutUser(
  db: DrizzleDb,
  userId: string,
): Promise<void> {
  await seedTenantMembershipRow(db, userId, defaultTenantSeed);
}

export async function seedTenantMembership(
  db: DrizzleDb,
  userId: string,
  tenant: TenantSeed,
): Promise<void> {
  await seedBetterAuthUser(
    db,
    {
      id: userId,
      name: 'Test User',
      email: `${userId}@example.com`,
      role: 'user',
    },
    { onConflict: 'nothing' },
  );
  await seedTenantMembershipRow(db, userId, tenant);
}

export async function seedTenantUserRow(
  db: DrizzleDb,
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: 'admin' | 'user';
  },
): Promise<void> {
  await seedBetterAuthUserRow(db, {
    id: user.id,
    name: user.name ?? 'Test User',
    email: user.email ?? `${user.id}@example.com`,
    role: user.role,
  });
  await seedDefaultTenantMembership(db, user.id);
}

export async function readBetterAuthUserRole(
  db: DrizzleDb,
  userId: string,
): Promise<string | null> {
  const result = await db.execute(
    sql`SELECT role FROM "user" WHERE id = ${userId} LIMIT 1`,
  );
  const rows = (result as unknown as { rows: { role: string | null }[] }).rows;
  return rows[0]?.role ?? null;
}

/**
 * Seed a role row directly in `roles`. We do not use the seeded system roles
 * because this test should not depend on `RolesService.seed()` side effects.
 */
export async function seedRole(
  db: DrizzleDb,
  overrides: Partial<typeof roles.$inferInsert> = {},
) {
  const [row] = await db
    .insert(roles)
    .values({
      id: overrides.id ?? randomUUID(),
      name: overrides.name ?? `Role-${randomUUID().slice(0, 8)}`,
      tenant_id: overrides.tenant_id ?? DEFAULT_TENANT_ID,
      description: overrides.description ?? null,
      is_system: overrides.is_system ?? false,
    })
    .returning();
  return row!;
}
