import { Cache, Duration, Effect } from 'effect';
import { and, eq } from 'drizzle-orm';
import { type Permission, type Resource } from '@stocket/types/auth';
import type { CreateRoleDto, UpdateRoleDto } from '@stocket/types/roles';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import { makeTryAsync } from '../../platform/effect/try-async';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { userRoles, roles, rolePermissions } from '../../platform/db/schema';
import type { UserPermissions } from '../../platform/auth/permission-provider';
import {
  DEFAULT_TENANT_ID,
  requireRequestTenantId,
} from '../../platform/tenancy/tenant-context';
import { toRoleResponseDto } from './roles.utils';
import {
  RoleNameAlreadyExists,
  RoleNotFound,
  RolesInfrastructureError,
  SystemRoleDeletionForbidden,
} from './roles.errors';
import { RolesRepository } from './repository';
import { defaultRoleSeedDefinitions } from '../../platform/seed/default-roles';

export type { UserPermissions };

export { defaultRoleSeedDefinitions };

export class RolesService extends Effect.Service<RolesService>()(
  '@stocket/effect/roles/RolesService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* RolesRepository;
      const db = yield* DrizzleDatabase;

      const getRoleOrFail = makeGetOrFail(
        (id: string) =>
          Effect.flatMap(currentTenantId, (tenantId) =>
            repository.findById(id, tenantId),
          ),
        (id) => new RoleNotFound({ id, messageKey: 'roles.notFound' }),
      );

      const tryAsync = makeTryAsync(
        (action, cause) =>
          new RolesInfrastructureError({
            action,
            cause,
            messageKey: 'roles.loadPermissionsFailed',
          }),
      );

      const currentTenantId = requireRequestTenantId;

      const fetchPermissionsFromDb = (
        userId: string,
        tenantId: string,
      ): Effect.Effect<UserPermissions, RolesInfrastructureError> =>
        tryAsync('load user permissions', async () => {
          const rows = await db
            .select({
              role_name: roles.name,
              resource: rolePermissions.resource,
              permission: rolePermissions.permission,
            })
            .from(userRoles)
            .innerJoin(roles, eq(roles.id, userRoles.role_id))
            .innerJoin(
              rolePermissions,
              eq(rolePermissions.role_id, userRoles.role_id),
            )
            .where(
              and(
                eq(userRoles.user_id, userId),
                eq(userRoles.tenant_id, tenantId),
                eq(roles.tenant_id, tenantId),
              ),
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

      const permissionCache = yield* Cache.make({
        capacity: 1000,
        timeToLive: Duration.minutes(1),
        lookup: (cacheKey: string) => {
          const [tenantId, userId] = cacheKey.split(':', 2);
          return fetchPermissionsFromDb(userId ?? '', tenantId ?? '');
        },
      });

      const clearCacheForUser = (_userId: string) =>
        permissionCache.invalidateAll;

      const clearAllCache = () => permissionCache.invalidateAll;

      const getPermissionsForUser = (userId: string, tenantId: string) =>
        permissionCache.get(`${tenantId}:${userId}`);

      const seedDefaultRolesForTenant = (tenantId: string) =>
        Effect.forEach(defaultRoleSeedDefinitions, (seed) =>
          Effect.gen(function* () {
            const existing = yield* repository.findByName(seed.name, tenantId);
            if (existing) {
              return;
            }

            const role = yield* repository.create({
              tenant_id: tenantId,
              name: seed.name,
              description: seed.description,
              is_system: true,
            });

            yield* repository.replacePermissions(role.id, seed.permissions);
          }),
        ).pipe(
          Effect.asVoid,
          Effect.withSpan('RolesService.seedDefaultRolesForTenant', {
            attributes: { tenantId },
          }),
        );

      return {
        findAll: () =>
          Effect.gen(function* () {
            const tenantId = yield* currentTenantId;
            const roles = yield* repository.findAll(tenantId);
            return roles.map(toRoleResponseDto);
          }).pipe(Effect.withSpan('RolesService.findAll')),
        findById: (id: string) =>
          Effect.gen(function* () {
            const role = yield* getRoleOrFail(id);
            return toRoleResponseDto(role);
          }).pipe(
            Effect.withSpan('RolesService.findById', { attributes: { id } }),
          ),
        create: (dto: CreateRoleDto) =>
          Effect.gen(function* () {
            const tenantId = yield* currentTenantId;
            const existing = yield* repository.findByName(dto.name, tenantId);
            if (existing) {
              return yield* Effect.fail(
                new RoleNameAlreadyExists({
                  name: dto.name,
                  messageKey: 'roles.nameAlreadyExists',
                }),
              );
            }

            const role = yield* repository.create({
              tenant_id: tenantId,
              name: dto.name,
              description: dto.description ?? null,
              is_system: false,
            });

            yield* repository.replacePermissions(role.id, dto.permissions);

            const created = yield* getRoleOrFail(role.id);
            return toRoleResponseDto(created);
          }).pipe(Effect.withSpan('RolesService.create')),
        update: (id: string, dto: UpdateRoleDto) =>
          Effect.gen(function* () {
            const tenantId = yield* currentTenantId;
            const role = yield* getRoleOrFail(id);

            const nextName = dto.name;
            if (nextName && nextName !== role.name) {
              const existing = yield* repository.findByName(nextName, tenantId);
              if (existing) {
                return yield* Effect.fail(
                  new RoleNameAlreadyExists({
                    name: nextName,
                    messageKey: 'roles.nameAlreadyExists',
                  }),
                );
              }
            }

            const updateData: Partial<typeof roles.$inferInsert> = {};
            if (dto.name !== undefined) updateData.name = dto.name;
            if (dto.description !== undefined) {
              updateData.description = dto.description ?? null;
            }

            if (Object.keys(updateData).length > 0) {
              yield* repository.update(id, tenantId, updateData);
            }

            if (dto.permissions !== undefined) {
              const { permissions } = dto;
              yield* repository.replacePermissions(id, permissions);
              yield* clearAllCache();
            }

            const updated = yield* getRoleOrFail(id);
            return toRoleResponseDto(updated);
          }).pipe(
            Effect.withSpan('RolesService.update', { attributes: { id } }),
          ),
        delete: (id: string) =>
          Effect.gen(function* () {
            const tenantId = yield* currentTenantId;
            const role = yield* getRoleOrFail(id);
            if (role.is_system) {
              return yield* Effect.fail(
                new SystemRoleDeletionForbidden({
                  id,
                  messageKey: 'roles.systemDeletionForbidden',
                }),
              );
            }

            yield* repository.delete(id, tenantId);
            yield* clearAllCache();
          }).pipe(
            Effect.withSpan('RolesService.delete', { attributes: { id } }),
          ),
        getPermissionsForUser: (userId: string, tenantId?: string) =>
          Effect.gen(function* () {
            const effectiveTenantId = tenantId ?? (yield* currentTenantId);
            return yield* getPermissionsForUser(userId, effectiveTenantId);
          }).pipe(
            Effect.withSpan('RolesService.getPermissionsForUser', {
              attributes: { userId, tenantId },
            }),
          ),
        clearCacheForUser: (userId: string) =>
          clearCacheForUser(userId).pipe(
            Effect.withSpan('RolesService.clearCacheForUser', {
              attributes: { userId },
            }),
          ),
        clearAllCache: () =>
          clearAllCache().pipe(Effect.withSpan('RolesService.clearAllCache')),
        seedDefaultRolesForTenant,
        seed: () =>
          seedDefaultRolesForTenant(DEFAULT_TENANT_ID).pipe(
            Effect.withSpan('RolesService.seed'),
          ),
      };
    }),
    dependencies: [RolesRepository.Default],
  },
) {}
