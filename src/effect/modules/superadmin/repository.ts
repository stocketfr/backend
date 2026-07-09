import { randomUUID } from 'node:crypto';
import { Effect, Schema } from 'effect';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { executeRows } from '../../platform/db/execute-rows';
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
import {
  SuperAdminUserRowSchema,
  type CreatedTenantResult,
  type CreateTenantInput,
  type PlatformAuditEventInput,
} from './types';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new SuperAdminRepositoryError({
      action,
      cause,
      messageKey: 'superadmin.repositoryFailed',
    }),
);

const ExistsRowSchema = Schema.Struct({
  exists: Schema.Number,
});

export class SuperAdminRepository extends Effect.Service<SuperAdminRepository>()(
  '@stocket/effect/superadmin/SuperAdminRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;

      const findSuperAdminUser = (userId: string) =>
        tryAsync('find superadmin user', async () => {
          const rows = await executeRows(
            db,
            sql`
              SELECT u.id, u.email, u.name
              FROM "user" u
              INNER JOIN super_admins sa ON sa.user_id = u.id
              WHERE u.id = ${userId}
              LIMIT 1
            `,
            SuperAdminUserRowSchema,
          );

          return rows[0] ?? null;
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
          const tenantId = randomUUID();

          return db.transaction(async (tx) => {
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
              .where(
                and(eq(roles.tenant_id, tenantId), eq(roles.name, 'Admin')),
              )
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
          });
        });

      const deleteTenant = (tenantId: string) =>
        tryAsync('delete platform tenant', async () =>
          db.transaction(async (tx) => {
            const [tenant] = await tx
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
              .where(eq(organizations.id, tenantId))
              .limit(1);

            if (!tenant) {
              return null;
            }

            const sessionActiveOrganizationColumns = await executeRows(
              tx,
              sql`
                SELECT 1 AS exists
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'session'
                  AND column_name = 'active_organization_id'
                LIMIT 1
              `,
              ExistsRowSchema,
            );
            if (sessionActiveOrganizationColumns.length > 0) {
              await tx.execute(sql`
                UPDATE "session"
                SET active_organization_id = NULL
                WHERE active_organization_id = ${tenantId}
              `);
            }
            await tx.execute(
              sql`DELETE FROM notifications WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM notification_preferences WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM tenant_feature_overrides WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM tenant_entitlement_profiles WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM audit_logs WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM stock_movements WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM inventory WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(sql`
              DELETE FROM order_items
              WHERE order_id IN (
                SELECT id FROM orders WHERE tenant_id = ${tenantId}
              )
            `);
            await tx.execute(
              sql`DELETE FROM orders WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM supplier_products WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(sql`
              DELETE FROM photos
              WHERE product_id IN (
                SELECT id FROM products WHERE tenant_id = ${tenantId}
              )
            `);
            await tx.execute(
              sql`DELETE FROM products WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM areas WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM locations WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM clients WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM suppliers WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM categories WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM user_roles WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(sql`
              DELETE FROM role_permissions
              WHERE role_id IN (
                SELECT id FROM roles WHERE tenant_id = ${tenantId}
              )
            `);
            await tx.execute(
              sql`DELETE FROM roles WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM branding_settings WHERE tenant_id = ${tenantId}`,
            );
            await tx.execute(
              sql`DELETE FROM tenant_domains WHERE tenant_id = ${tenantId}`,
            );
            const invitationTables = await executeRows(
              tx,
              sql`
                SELECT 1 AS exists
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name = 'invitation'
                LIMIT 1
              `,
              ExistsRowSchema,
            );
            if (invitationTables.length > 0) {
              await tx.execute(
                sql`DELETE FROM invitation WHERE organization_id = ${tenantId}`,
              );
            }
            await tx.execute(
              sql`DELETE FROM member WHERE organization_id = ${tenantId}`,
            );

            await tx
              .delete(organizations)
              .where(eq(organizations.id, tenantId));

            return tenant;
          }),
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
        deleteTenant,
        recordPlatformAuditEvent,
      };
    }),
  },
) {}
