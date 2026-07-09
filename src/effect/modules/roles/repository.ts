import { Effect } from 'effect';
import { and, eq, asc, inArray } from 'drizzle-orm';
import { type Permission, type Resource } from '@stocket/types/auth';
import { makeTryAsync } from '../../platform/effect/try-async';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import { roles, rolePermissions, userRoles } from '../../platform/db/schema';
import type { UserPermissions } from '../../platform/auth/permission-provider';
import { RolesInfrastructureError } from './roles.errors';

type RoleCreateInput = typeof roles.$inferInsert & {
  readonly tenant_id: string;
};

const tryAsync = makeTryAsync(
  (action, cause) =>
    new RolesInfrastructureError({
      action,
      cause,
      messageKey: 'roles.repositoryFailed',
    }),
);

const tryLoadPermissions = makeTryAsync(
  (action, cause) =>
    new RolesInfrastructureError({
      action,
      cause,
      messageKey: 'roles.loadPermissionsFailed',
    }),
);

export class RolesRepository extends Effect.Service<RolesRepository>()(
  '@stocket/effect/roles/RolesRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;

      const findPermissionsForUser = (
        userId: string,
        tenantId: string,
      ): Effect.Effect<UserPermissions, RolesInfrastructureError> =>
        tryLoadPermissions('load user permissions', async () => {
          const tenantScope = tenantQuery.forTenant(tenantId);
          const rows = await db
            .select({
              role_name: roles.name,
              resource: rolePermissions.resource,
              permission: rolePermissions.permission,
            })
            .from(userRoles)
            .innerJoin(
              roles,
              and(
                eq(roles.id, userRoles.role_id),
                tenantScope.tenantPredicate(roles),
              ),
            )
            .innerJoin(
              rolePermissions,
              eq(rolePermissions.role_id, userRoles.role_id),
            )
            .where(
              tenantScope.whereTenant(userRoles, eq(userRoles.user_id, userId)),
            );

          const roleNames = [...new Set(rows.map((row) => row.role_name))];
          const permissionMap: Record<string, Set<string>> = {};

          for (const row of rows) {
            const resourcePermissions = (permissionMap[row.resource] ??=
              new Set());
            resourcePermissions.add(row.permission);
          }

          const permissions: Partial<Record<Resource, Permission[]>> = {};
          for (const [resource, permissionSet] of Object.entries(
            permissionMap,
          )) {
            permissions[resource as Resource] = [
              ...permissionSet,
            ] as Permission[];
          }

          return { roleNames, permissions };
        });

      const findAll = (tenantId: string) =>
        tryAsync('list roles', async () => {
          const tenantScope = tenantQuery.forTenant(tenantId);
          const allRoles = await db
            .select()
            .from(roles)
            .where(tenantScope.whereTenant(roles))
            .orderBy(asc(roles.name));

          const allPermissions =
            allRoles.length > 0
              ? await db
                  .select()
                  .from(rolePermissions)
                  .where(
                    inArray(
                      rolePermissions.role_id,
                      allRoles.map((role) => role.id),
                    ),
                  )
              : [];
          const allRoleIds = new Set(allRoles.map((role) => role.id));

          return allRoles.map((role) => ({
            ...role,
            permissions: allPermissions.filter(
              (p) => p.role_id === role.id && allRoleIds.has(p.role_id),
            ),
          }));
        });

      const findById = (id: string, tenantId: string) =>
        tryAsync('load role', async () => {
          const tenantScope = tenantQuery.forTenant(tenantId);
          const rows = await db
            .select()
            .from(roles)
            .where(tenantScope.whereTenantId(roles, id))
            .limit(1);
          if (!rows[0]) return null;

          const perms = await db
            .select()
            .from(rolePermissions)
            .where(eq(rolePermissions.role_id, id));

          return { ...rows[0], permissions: perms };
        });

      const findByName = (name: string, tenantId: string) =>
        tryAsync('load role by name', async () => {
          const tenantScope = tenantQuery.forTenant(tenantId);
          const rows = await db
            .select()
            .from(roles)
            .where(tenantScope.whereTenant(roles, eq(roles.name, name)))
            .limit(1);
          if (!rows[0]) return null;

          const perms = await db
            .select()
            .from(rolePermissions)
            .where(eq(rolePermissions.role_id, rows[0].id));

          return { ...rows[0], permissions: perms };
        });

      const create = (data: RoleCreateInput) =>
        tryAsync('create role', async () => {
          const { tenant_id: tenantId, ...roleData } = data;
          const tenantScope = tenantQuery.forTenant(tenantId);
          const rows = await db
            .insert(roles)
            .values(tenantScope.insertValues(roleData))
            .returning();
          return { ...rows[0]!, permissions: [] };
        });

      const update = (
        id: string,
        tenantId: string,
        data: Partial<typeof roles.$inferInsert>,
      ) =>
        tryAsync('update role', async () => {
          const { tenant_id: _tenantId, ...updateData } = data;
          const tenantScope = tenantQuery.forTenant(tenantId);
          await db
            .update(roles)
            .set({ ...updateData, updated_at: new Date() })
            .where(tenantScope.whereTenantId(roles, id));
        });

      const remove = (id: string, tenantId: string) =>
        tryAsync('delete role', async () => {
          const tenantScope = tenantQuery.forTenant(tenantId);
          await db.delete(roles).where(tenantScope.whereTenantId(roles, id));
        });

      const replacePermissions = (
        tenantId: string,
        roleId: string,
        permissions: { resource: string; permission: string }[],
      ) =>
        tryAsync('replace role permissions', async () => {
          const tenantScope = tenantQuery.forTenant(tenantId);
          await db.transaction(async (tx) => {
            const roleRows = await tx
              .select({ id: roles.id })
              .from(roles)
              .where(tenantScope.whereTenantId(roles, roleId))
              .limit(1);

            if (!roleRows[0]) {
              throw new Error('Role does not belong to tenant');
            }

            await tx
              .delete(rolePermissions)
              .where(eq(rolePermissions.role_id, roleId));

            if (permissions.length === 0) {
              return;
            }

            await tx.insert(rolePermissions).values(
              permissions.map((p) => ({
                role_id: roleId,
                resource: p.resource,
                permission: p.permission,
              })),
            );
          });
        });

      return {
        findPermissionsForUser,
        findAll,
        findById,
        findByName,
        create,
        update,
        delete: remove,
        replacePermissions,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
