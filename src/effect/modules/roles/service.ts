import { Cache, Duration, Effect } from 'effect';
import type { CreateRoleDto, UpdateRoleDto } from '@stocket/types/roles';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import type { UserPermissions } from '../../platform/auth/permission-provider';
import {
  DEFAULT_TENANT_ID,
  requireRequestTenantId,
} from '../../platform/tenancy/tenant-context';
import { toRoleResponseDto } from './mappers';
import { RolesRepository } from './repository';
import { defaultRoleSeedDefinitions } from '../../platform/seed/default-roles';
import { makeRoleWriteWorkflows } from './write';

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

      const roleWriteWorkflows = makeRoleWriteWorkflows({
        repository,
        clearAllCache,
      });

      const seedDefaultRolesForTenant = (tenantId: string) =>
        roleWriteWorkflows.seedDefaultRolesForTenant(tenantId).pipe(
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
            const tenantId = yield* currentTenantId;
            const role = yield* roleWriteWorkflows.getRoleOrFail(id, tenantId);
            return toRoleResponseDto(role);
          }).pipe(trace.span('findById', { attributes: { id } })),
        create: (dto: CreateRoleDto) =>
          Effect.gen(function* () {
            const tenantId = yield* currentTenantId;
            return yield* roleWriteWorkflows.create(dto, tenantId);
          }).pipe(trace.span('create')),
        update: (id: string, dto: UpdateRoleDto) =>
          Effect.gen(function* () {
            const tenantId = yield* currentTenantId;
            return yield* roleWriteWorkflows.update(id, dto, tenantId);
          }).pipe(trace.span('update', { attributes: { id } })),
        delete: (id: string) =>
          Effect.gen(function* () {
            const tenantId = yield* currentTenantId;
            yield* roleWriteWorkflows.delete(id, tenantId);
          }).pipe(trace.span('delete', { attributes: { id } })),
        getPermissionsForUser: (userId: string, tenantId?: string) =>
          Effect.gen(function* () {
            const effectiveTenantId = tenantId ?? (yield* currentTenantId);
            return yield* getPermissionsForUser(userId, effectiveTenantId);
          }).pipe(
            trace.span('getPermissionsForUser', {
              attributes: { userId, tenantId },
            }),
          ),
        clearCacheForUser: (userId: string) =>
          clearCacheForUser(userId).pipe(
            trace.span('clearCacheForUser', {
              attributes: { userId },
            }),
          ),
        clearAllCache: () => clearAllCache().pipe(trace.span('clearAllCache')),
        seedDefaultRolesForTenant,
        seed: () =>
          seedDefaultRolesForTenant(DEFAULT_TENANT_ID).pipe(trace.span('seed')),
      };
    }),
    dependencies: [RolesRepository.Default],
  },
) {}
