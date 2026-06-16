import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { makeTryAsync } from '../../platform/effect/try-async';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { userRoles, roles, members } from '../../platform/db/schema';
import { UsersInfrastructureError } from './users.errors';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new UsersInfrastructureError({
      action,
      cause,
      messageKey: 'users.repositoryFailed',
    }),
);

export interface TenantUserRow {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly image: string | null;
  readonly banned: boolean | null;
  readonly banReason: string | null;
  readonly banExpires: Date | null;
  readonly createdAt: Date;
}

interface ListTenantUsersOptions {
  readonly tenantId: string;
  readonly offset: number;
  readonly limit: number;
  readonly search?: string;
  readonly role?: string;
}

export class UsersRepository extends Effect.Service<UsersRepository>()(
  '@stocket/effect/users/UsersRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;

      const findRoleAssignments = (userIds: string[], tenantId: string) =>
        tryAsync('find role assignments', async () => {
          if (userIds.length === 0) return [];

          const rows = await db
            .select({
              id: userRoles.id,
              user_id: userRoles.user_id,
              role_id: userRoles.role_id,
              role: roles,
            })
            .from(userRoles)
            .innerJoin(roles, eq(userRoles.role_id, roles.id))
            .where(
              and(
                inArray(userRoles.user_id, userIds),
                eq(userRoles.tenant_id, tenantId),
                eq(roles.tenant_id, tenantId),
              ),
            );

          return rows;
        });

      const findUserRoles = (userId: string, tenantId: string) =>
        tryAsync('find user roles', async () => {
          const rows = await db
            .select({
              id: userRoles.id,
              user_id: userRoles.user_id,
              role_id: userRoles.role_id,
              role: roles,
            })
            .from(userRoles)
            .innerJoin(roles, eq(userRoles.role_id, roles.id))
            .where(
              and(
                eq(userRoles.user_id, userId),
                eq(userRoles.tenant_id, tenantId),
                eq(roles.tenant_id, tenantId),
              ),
            );

          return rows;
        });

      const validateRoleIds = (roleIds: string[], tenantId: string) =>
        tryAsync('validate user roles', async () => {
          const uniqueRoleIds = [...new Set(roleIds)];
          if (uniqueRoleIds.length === 0) return;

          const tenantRoles = await db
            .select({ id: roles.id })
            .from(roles)
            .where(
              and(
                inArray(roles.id, uniqueRoleIds),
                eq(roles.tenant_id, tenantId),
              ),
            );

          if (tenantRoles.length !== uniqueRoleIds.length) {
            throw new Error('One or more roles do not belong to tenant');
          }
        });

      const replaceUserRoles = (
        userId: string,
        roleIds: string[],
        tenantId: string,
      ) =>
        tryAsync('replace user roles', async () => {
          const uniqueRoleIds = [...new Set(roleIds)];

          await db.transaction(async (tx) => {
            if (uniqueRoleIds.length > 0) {
              const tenantRoles = await tx
                .select({ id: roles.id })
                .from(roles)
                .where(
                  and(
                    inArray(roles.id, uniqueRoleIds),
                    eq(roles.tenant_id, tenantId),
                  ),
                );

              if (tenantRoles.length !== uniqueRoleIds.length) {
                throw new Error('One or more roles do not belong to tenant');
              }
            }

            await tx
              .delete(userRoles)
              .where(
                and(
                  eq(userRoles.user_id, userId),
                  eq(userRoles.tenant_id, tenantId),
                ),
              );

            if (uniqueRoleIds.length === 0) {
              return;
            }

            await tx.insert(userRoles).values(
              uniqueRoleIds.map((roleId) => ({
                user_id: userId,
                tenant_id: tenantId,
                role_id: roleId,
              })),
            );
          });
        });

      const listTenantUsers = ({
        tenantId,
        offset,
        limit,
        search,
        role,
      }: ListTenantUsersOptions) =>
        tryAsync('list tenant users', async () => {
          const searchTerm = search?.trim() ? `%${search.trim()}%` : null;
          const roleName = role?.trim() || null;
          const fromAndWhere = sql`
	            FROM "member" m
	            INNER JOIN "user" u ON u.id::text = m.user_id
            LEFT JOIN user_roles ur
              ON ur.user_id = u.id::text
              AND ur.tenant_id = m.organization_id
            LEFT JOIN roles r
              ON r.id = ur.role_id
              AND r.tenant_id = m.organization_id
            WHERE m.organization_id = ${tenantId}
              AND (${searchTerm}::text IS NULL OR u.name ILIKE ${searchTerm})
              AND (${roleName}::text IS NULL OR LOWER(r.name) = LOWER(${roleName}))
          `;

          const countResult = await db.execute(sql`
            SELECT COUNT(DISTINCT u.id)::int AS total
            ${fromAndWhere}
          `);
          const total =
            ((countResult as unknown as { rows?: { total: number }[] }).rows ??
              (countResult as unknown as { total: number }[]))[0]?.total ?? 0;

          const result = await db.execute(sql`
            SELECT DISTINCT
              u.id,
              u.name,
              u.email,
              u.image,
              u.banned,
              u.ban_reason AS "banReason",
              u.ban_expires AS "banExpires",
              u.created_at AS "createdAt"
            ${fromAndWhere}
            ORDER BY "createdAt" ASC, id ASC
            LIMIT ${limit}
            OFFSET ${offset}
          `);
          const users =
            (result as unknown as { rows?: TenantUserRow[] }).rows ??
            (result as unknown as TenantUserRow[]);

          return { users, total };
        });

      const findBetterAuthUser = (userId: string) =>
        tryAsync('find better auth user', async () => {
          const result = await db.execute(sql`
            SELECT
              id,
              name,
              email,
              image,
              banned,
              ban_reason AS "banReason",
              ban_expires AS "banExpires",
              created_at AS "createdAt"
            FROM "user"
            WHERE id = ${userId}
            LIMIT 1
          `);
          const rows =
            (result as unknown as { rows?: TenantUserRow[] }).rows ??
            (result as unknown as TenantUserRow[]);
          return rows[0] ?? null;
        });

      const deleteBetterAuthUser = (userId: string) =>
        tryAsync('delete better auth user', async () => {
          await db.transaction(async (tx) => {
            await tx.execute(
              sql`DELETE FROM "session" WHERE user_id = ${userId}`,
            );
            await tx.execute(
              sql`DELETE FROM account WHERE user_id = ${userId}`,
            );
            await tx.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
          });
        });

      const banBetterAuthUser = (
        userId: string,
        options: { reason?: string; expiresAt?: string | null },
      ) =>
        tryAsync('ban better auth user', async () => {
          await db.execute(sql`
            UPDATE "user"
            SET
              banned = true,
              ban_reason = ${options.reason ?? null},
              ban_expires = ${
                options.expiresAt ? new Date(options.expiresAt) : null
              },
              updated_at = NOW()
            WHERE id = ${userId}
          `);
        });

      const unbanBetterAuthUser = (userId: string) =>
        tryAsync('unban better auth user', async () => {
          await db.execute(sql`
            UPDATE "user"
            SET
              banned = false,
              ban_reason = NULL,
              ban_expires = NULL,
              updated_at = NOW()
            WHERE id = ${userId}
          `);
        });

      const deleteBetterAuthSessions = (userId: string) =>
        tryAsync('delete better auth sessions', async () => {
          await db.execute(
            sql`DELETE FROM "session" WHERE user_id = ${userId}`,
          );
        });

      const deleteUserRoles = (userId: string, tenantId: string) =>
        tryAsync('delete user roles', () =>
          db
            .delete(userRoles)
            .where(
              and(
                eq(userRoles.user_id, userId),
                eq(userRoles.tenant_id, tenantId),
              ),
            ),
        );

      const deleteTenantMembership = (userId: string, tenantId: string) =>
        tryAsync('delete tenant membership', () =>
          db
            .delete(members)
            .where(
              and(
                eq(members.user_id, userId),
                eq(members.organization_id, tenantId),
              ),
            ),
        );

      const hasTenantMemberships = (userId: string) =>
        tryAsync('check tenant memberships', async () => {
          const rows = await db
            .select({ id: members.id })
            .from(members)
            .where(eq(members.user_id, userId))
            .limit(1);

          return rows.length > 0;
        });

      const hasTenantMembership = (userId: string, tenantId: string) =>
        tryAsync('check tenant membership', async () => {
          const rows = await db
            .select({ id: members.id })
            .from(members)
            .where(
              and(
                eq(members.user_id, userId),
                eq(members.organization_id, tenantId),
              ),
            )
            .limit(1);

          return rows.length > 0;
        });

      const createTenantMembership = (userId: string, tenantId: string) =>
        tryAsync('create tenant membership', async () => {
          await db
            .insert(members)
            .values({
              id: randomUUID(),
              organization_id: tenantId,
              user_id: userId,
              role: 'member',
            })
            .onConflictDoNothing();
        });

      return {
        findRoleAssignments,
        findUserRoles,
        validateRoleIds,
        replaceUserRoles,
        listTenantUsers,
        findBetterAuthUser,
        deleteBetterAuthUser,
        banBetterAuthUser,
        unbanBetterAuthUser,
        deleteBetterAuthSessions,
        deleteUserRoles,
        deleteTenantMembership,
        hasTenantMembership,
        hasTenantMemberships,
        createTenantMembership,
      };
    }),
  },
) {}
