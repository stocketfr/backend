import { Effect } from 'effect';
import { eq, asc, and, inArray } from 'drizzle-orm';
import { makeTryAsync } from '../../platform/effect/try-async';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { roles, rolePermissions } from '../../platform/db/schema';
import { RolesInfrastructureError } from './roles.errors';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new RolesInfrastructureError({
      action,
      cause,
      messageKey: 'roles.repositoryFailed',
    }),
);

export class RolesRepository extends Effect.Service<RolesRepository>()(
  '@stocket/effect/roles/RolesRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;

      const findAll = (tenantId: string) =>
        tryAsync('list roles', async () => {
          const allRoles = await db
            .select()
            .from(roles)
            .where(eq(roles.tenant_id, tenantId))
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
          const rows = await db
            .select()
            .from(roles)
            .where(and(eq(roles.id, id), eq(roles.tenant_id, tenantId)))
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
          const rows = await db
            .select()
            .from(roles)
            .where(and(eq(roles.name, name), eq(roles.tenant_id, tenantId)))
            .limit(1);
          if (!rows[0]) return null;

          const perms = await db
            .select()
            .from(rolePermissions)
            .where(eq(rolePermissions.role_id, rows[0].id));

          return { ...rows[0], permissions: perms };
        });

      const create = (data: typeof roles.$inferInsert) =>
        tryAsync('create role', async () => {
          const rows = await db.insert(roles).values(data).returning();
          return { ...rows[0]!, permissions: [] };
        });

      const update = (
        id: string,
        tenantId: string,
        data: Partial<typeof roles.$inferInsert>,
      ) =>
        tryAsync('update role', async () => {
          const { tenant_id: _tenantId, ...updateData } = data;
          await db
            .update(roles)
            .set({ ...updateData, updated_at: new Date() })
            .where(and(eq(roles.id, id), eq(roles.tenant_id, tenantId)));
        });

      const remove = (id: string, tenantId: string) =>
        tryAsync('delete role', async () => {
          await db
            .delete(roles)
            .where(and(eq(roles.id, id), eq(roles.tenant_id, tenantId)));
        });

      const replacePermissions = (
        roleId: string,
        permissions: { resource: string; permission: string }[],
      ) =>
        tryAsync('replace role permissions', async () => {
          await db
            .delete(rolePermissions)
            .where(eq(rolePermissions.role_id, roleId));

          if (permissions.length === 0) {
            return;
          }

          await db.insert(rolePermissions).values(
            permissions.map((p) => ({
              role_id: roleId,
              resource: p.resource,
              permission: p.permission,
            })),
          );
        });

      return {
        findAll,
        findById,
        findByName,
        create,
        update,
        delete: remove,
        replacePermissions,
      };
    }),
  },
) {}
