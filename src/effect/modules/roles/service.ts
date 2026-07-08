import { Cache, Duration, Effect } from 'effect';
import type { CreateRoleDto, UpdateRoleDto } from '@stocket/types/roles';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import {
  hasDefinedPatchValues,
  pickDefined,
} from '../../platform/effect/pick-defined';
import type { roles } from '../../platform/db/schema';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import type { UserPermissions } from '../../platform/auth/permission-provider';
import {
  DEFAULT_TENANT_ID,
  requireRequestTenantId,
} from '../../platform/tenancy/tenant-context';
import { toRoleResponseDto } from './roles.utils';
import {
  RoleNameAlreadyExists,
  RoleNotFound,
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
      const trace = makeServiceTracer({
        serviceName: 'RolesService',
        module: 'roles',
        layer: 'service',
      });

      const getRoleOrFail = makeGetOrFail(
        (id: string) =>
          Effect.flatMap(currentTenantId, (tenantId) =>
            repository.findById(id, tenantId),
          ),
        (id) => new RoleNotFound({ id, messageKey: 'roles.notFound' }),
      );

      const currentTenantId = requireRequestTenantId;

      const permissionCache = yield* Cache.make({
        capacity: 1000,
        timeToLive: Duration.minutes(1),
        lookup: (cacheKey: string) => {
          const [tenantId, userId] = cacheKey.split(':', 2);
          return repository.findPermissionsForUser(
            userId ?? '',
            tenantId ?? '',
          );
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

            yield* repository.replacePermissions(
              tenantId,
              role.id,
              seed.permissions,
            );
          }),
        ).pipe(
          Effect.asVoid,
          trace.span('seedDefaultRolesForTenant', {
            attributes: { tenantId },
          }),
        );

      return {
        findAll: () =>
          Effect.gen(function* () {
            const tenantId = yield* currentTenantId;
            const roles = yield* repository.findAll(tenantId);
            return roles.map(toRoleResponseDto);
          }).pipe(trace.span('findAll')),
        findById: (id: string) =>
          Effect.gen(function* () {
            const role = yield* getRoleOrFail(id);
            return toRoleResponseDto(role);
          }).pipe(trace.span('findById', { attributes: { id } })),
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

            yield* repository.replacePermissions(
              tenantId,
              role.id,
              dto.permissions,
            );

            const created = yield* getRoleOrFail(role.id);
            return toRoleResponseDto(created);
          }).pipe(trace.span('create')),
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

            const updateData = pickDefined<typeof roles.$inferInsert>([
              ['name', dto.name],
              [
                'description',
                dto.description === undefined
                  ? undefined
                  : dto.description ?? null,
              ],
            ]);

            if (hasDefinedPatchValues(updateData)) {
              yield* repository.update(id, tenantId, updateData);
            }

            if (dto.permissions !== undefined) {
              const { permissions } = dto;
              yield* repository.replacePermissions(tenantId, id, permissions);
              yield* clearAllCache();
            }

            const updated = yield* getRoleOrFail(id);
            return toRoleResponseDto(updated);
          }).pipe(trace.span('update', { attributes: { id } })),
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
          }).pipe(trace.span('delete', { attributes: { id } })),
        getPermissionsForUser: (userId: string, tenantId?: string) =>
          Effect.gen(function* () {
            const effectiveTenantId = tenantId ?? (yield* currentTenantId);
            return yield* getPermissionsForUser(userId, effectiveTenantId);
          }).pipe(trace.span('getPermissionsForUser', {
            attributes: { userId, tenantId },
          })),
        clearCacheForUser: (userId: string) =>
          clearCacheForUser(userId).pipe(
            trace.span('clearCacheForUser', {
              attributes: { userId },
            }),
          ),
        clearAllCache: () =>
          clearAllCache().pipe(trace.span('clearAllCache')),
        seedDefaultRolesForTenant,
        seed: () =>
          seedDefaultRolesForTenant(DEFAULT_TENANT_ID).pipe(
            trace.span('seed'),
          ),
      };
    }),
    dependencies: [RolesRepository.Default],
  },
) {}
