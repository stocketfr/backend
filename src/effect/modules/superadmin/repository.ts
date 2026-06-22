import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DrizzleDatabase, type DrizzleDb } from '../../platform/db/drizzle';
import {
  betterAuthUsers,
  members,
  organizations,
  platformAuditEvents,
  rolePermissions,
  roles,
  tenantDomains,
  userRoles,
} from '../../platform/db/schema';
import { makeTryAsync } from '../../platform/effect/try-async';
import { defaultRoleSeedDefinitions } from '../../platform/seed/default-roles';
import { SuperAdminRepositoryError } from './superadmin.errors';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new SuperAdminRepositoryError({
      action,
      cause,
      messageKey: 'superadmin.repositoryFailed',
    }),
);

export interface SuperAdminUserRow {
  readonly id: string;
  readonly email: string | null;
  readonly name: string | null;
}

export interface TenantListRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly primaryHostname: string | null;
  readonly createdAt: Date;
}

export interface CreateTenantInput {
  readonly name: string;
  readonly slug: string;
  readonly hostname: string;
  readonly adminUserId: string;
}

export interface PlatformAuditEventInput {
  readonly actorUserId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly metadata?: Record<string, unknown>;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface CreatedTenantResult {
  readonly tenant: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly hostname: string;
  };
  readonly admin: {
    readonly id: string;
  };
}

const rowsOf = <A>(result: unknown): A[] =>
  ((result as { rows?: A[] }).rows ?? (result as A[])) as A[];

const insertTenantWithAdmin = async (
  tx: DrizzleDb,
  input: CreateTenantInput,
): Promise<CreatedTenantResult> => {
  const tenantId = randomUUID();

  const [tenant] = await tx
    .insert(organizations)
    .values({
      id: tenantId,
      name: input.name,
      slug: input.slug,
    })
    .returning({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
    });

  await tx.insert(tenantDomains).values({
    tenant_id: tenantId,
    hostname: input.hostname,
    kind: 'subdomain',
    is_primary: true,
    verified_at: new Date(),
  });

  for (const seed of defaultRoleSeedDefinitions) {
    const [role] = await tx
      .insert(roles)
      .values({
        tenant_id: tenantId,
        name: seed.name,
        description: seed.description,
        is_system: true,
      })
      .returning({ id: roles.id });

    await tx.insert(rolePermissions).values(
      seed.permissions.map((permission) => ({
        role_id: role!.id,
        resource: permission.resource,
        permission: permission.permission,
      })),
    );
  }

  await tx
    .insert(members)
    .values({
      id: randomUUID(),
      organization_id: tenantId,
      user_id: input.adminUserId,
      role: 'member',
    })
    .onConflictDoNothing();

  const adminRoleRows = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenant_id, tenantId), eq(roles.name, 'Admin')))
    .limit(1);

  const adminRoleId = adminRoleRows[0]?.id;
  if (!adminRoleId) {
    throw new Error('Admin role seed missing after tenant creation');
  }

  await tx.insert(userRoles).values({
    tenant_id: tenantId,
    user_id: input.adminUserId,
    role_id: adminRoleId,
  });

  return {
    tenant: {
      id: tenant!.id,
      name: tenant!.name,
      slug: tenant!.slug,
      hostname: input.hostname,
    },
    admin: {
      id: input.adminUserId,
    },
  } satisfies CreatedTenantResult;
};

export class SuperAdminRepository extends Effect.Service<SuperAdminRepository>()(
  '@stocket/effect/superadmin/SuperAdminRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;

      const findSuperAdminUser = (userId: string) =>
        tryAsync('find superadmin user', async () => {
          const result = await db.execute(sql`
            SELECT u.id, u.email, u.name
            FROM "user" u
            INNER JOIN super_admins sa ON sa.user_id = u.id
            WHERE u.id = ${userId}
            LIMIT 1
          `);

          return rowsOf<SuperAdminUserRow>(result)[0] ?? null;
        });

      const findBetterAuthUserByLoweredEmail = (normalizedEmail: string) =>
        tryAsync('find better auth user by email', async () => {
          const rows = await db
            .select({
              id: betterAuthUsers.id,
              name: betterAuthUsers.name,
              email: betterAuthUsers.email,
            })
            .from(betterAuthUsers)
            .where(sql`lower(${betterAuthUsers.email}) = ${normalizedEmail}`)
            .limit(1);
          return rows[0] ?? null;
        });

      const listTenants = () =>
        tryAsync('list platform tenants', async () => {
          const rows = await db
            .select({
              id: organizations.id,
              name: organizations.name,
              slug: organizations.slug,
              primaryHostname: tenantDomains.hostname,
              createdAt: organizations.created_at,
            })
            .from(organizations)
            .leftJoin(
              tenantDomains,
              and(
                eq(tenantDomains.tenant_id, organizations.id),
                eq(tenantDomains.is_primary, true),
              ),
            )
            .orderBy(asc(organizations.created_at), asc(organizations.name));

          return rows;
        });

      const tenantSlugExists = (slug: string) =>
        tryAsync('check tenant slug', async () => {
          const rows = await db
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.slug, slug))
            .limit(1);
          return rows.length > 0;
        });

      const tenantHostnameExists = (hostname: string) =>
        tryAsync('check tenant hostname', async () => {
          const rows = await db
            .select({ id: tenantDomains.id })
            .from(tenantDomains)
            .where(eq(tenantDomains.hostname, hostname))
            .limit(1);
          return rows.length > 0;
        });

      const createTenantWithAdmin = (input: CreateTenantInput) =>
        tryAsync('create tenant with admin', async () => {
          return db.transaction(async (tx) =>
            insertTenantWithAdmin(tx as unknown as DrizzleDb, input),
          );
        });

      const createTenantWithAdminRecords = (input: CreateTenantInput) =>
        tryAsync('create tenant with admin records', () =>
          insertTenantWithAdmin(db, input),
        );

      const recordPlatformAuditEvent = (input: PlatformAuditEventInput) =>
        tryAsync('record platform audit event', async () => {
          await db.insert(platformAuditEvents).values({
            actor_user_id: input.actorUserId,
            action: input.action,
            entity_type: input.entityType,
            entity_id: input.entityId,
            metadata: input.metadata ?? null,
            ip_address: input.ipAddress ?? null,
            user_agent: input.userAgent ?? null,
          });
        });

      return {
        findSuperAdminUser,
        findBetterAuthUserByLoweredEmail,
        listTenants,
        tenantSlugExists,
        tenantHostnameExists,
        createTenantWithAdmin,
        createTenantWithAdminRecords,
        recordPlatformAuditEvent,
      };
    }),
  },
) {}
