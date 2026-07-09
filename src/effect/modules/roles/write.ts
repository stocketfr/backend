import { Effect } from 'effect';
import type {
  CreateRoleDto,
  RolePermissionDto,
  UpdateRoleDto,
} from '@stocket/types/roles';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import {
  hasDefinedPatchValues,
  pickDefined,
} from '../../platform/effect/pick-defined';
import type { roles } from '../../platform/db/schema';
import { defaultRoleSeedDefinitions } from '../../platform/seed/default-roles';
import {
  RoleNameAlreadyExists,
  RoleNotFound,
  type RolesInfrastructureError,
  SystemRoleDeletionForbidden,
} from './roles.errors';
import { toRoleResponseDto } from './mappers';
import type { RoleWithPermissions } from './types';

type RoleCreateInput = typeof roles.$inferInsert & {
  readonly tenant_id: string;
};

type RoleUpdateInput = Partial<typeof roles.$inferInsert>;

export interface RoleWriteRepository {
  readonly findById: (
    id: string,
    tenantId: string,
  ) => Effect.Effect<RoleWithPermissions | null, RolesInfrastructureError>;
  readonly findByName: (
    name: string,
    tenantId: string,
  ) => Effect.Effect<RoleWithPermissions | null, RolesInfrastructureError>;
  readonly create: (
    data: RoleCreateInput,
  ) => Effect.Effect<RoleWithPermissions, RolesInfrastructureError>;
  readonly update: (
    id: string,
    tenantId: string,
    data: RoleUpdateInput,
  ) => Effect.Effect<unknown, RolesInfrastructureError>;
  readonly delete: (
    id: string,
    tenantId: string,
  ) => Effect.Effect<unknown, RolesInfrastructureError>;
  readonly replacePermissions: (
    tenantId: string,
    roleId: string,
    permissions: RolePermissionDto[],
  ) => Effect.Effect<unknown, RolesInfrastructureError>;
}

interface RoleWriteWorkflowOptions {
  readonly repository: RoleWriteRepository;
  readonly clearAllCache: () => Effect.Effect<void>;
}

const makeRoleNotFound = (id: string) =>
  new RoleNotFound({ id, messageKey: 'roles.notFound' });

export const makeRoleWriteWorkflows = ({
  repository,
  clearAllCache,
}: RoleWriteWorkflowOptions) => {
  const getRoleOrFail = (id: string, tenantId: string) =>
    makeGetOrFail(
      (roleId: string) => repository.findById(roleId, tenantId),
      makeRoleNotFound,
    )(id);

  const create = (dto: CreateRoleDto, tenantId: string) =>
    Effect.gen(function* () {
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

      yield* repository.replacePermissions(tenantId, role.id, dto.permissions);

      const created = yield* getRoleOrFail(role.id, tenantId);
      return toRoleResponseDto(created);
    });

  const update = (id: string, dto: UpdateRoleDto, tenantId: string) =>
    Effect.gen(function* () {
      const role = yield* getRoleOrFail(id, tenantId);

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
          dto.description === undefined ? undefined : (dto.description ?? null),
        ],
      ]);

      if (hasDefinedPatchValues(updateData)) {
        yield* repository.update(id, tenantId, updateData);
      }

      if (dto.permissions !== undefined) {
        yield* repository.replacePermissions(tenantId, id, dto.permissions);
        yield* clearAllCache();
      }

      const updated = yield* getRoleOrFail(id, tenantId);
      return toRoleResponseDto(updated);
    });

  const remove = (id: string, tenantId: string) =>
    Effect.gen(function* () {
      const role = yield* getRoleOrFail(id, tenantId);
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
    });

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
    ).pipe(Effect.asVoid);

  return {
    getRoleOrFail,
    create,
    update,
    delete: remove,
    seedDefaultRolesForTenant,
  };
};
