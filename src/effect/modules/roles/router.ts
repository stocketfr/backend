import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { Permission, Resource } from '@stocket/types/auth';
import {
  CreateRoleSchema,
  RoleIdSchema,
  UpdateRoleSchema,
  type UpdateRoleDto,
} from '@stocket/types/roles';
import { requirePermission } from '../../platform/auth/authorization';
import { respondEmpty, respondJson } from '../../platform/http/errors';
import { AuditLogWriter } from '../../platform/audit/index';
import { RolesService } from './service';

const RolePathParamsSchema = Schema.Struct({
  id: RoleIdSchema,
});

export const rolesRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.ROLES, Permission.READ);
      const rolesService = yield* RolesService;
      return yield* respondJson(rolesService.findAll());
    }),
  ),
  HttpRouter.get(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.ROLES, Permission.READ);
      const { id } = yield* HttpRouter.schemaPathParams(RolePathParamsSchema);
      const rolesService = yield* RolesService;
      return yield* respondJson(rolesService.findById(id));
    }),
  ),
  HttpRouter.post(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.ROLES, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(CreateRoleSchema);
      const rolesService = yield* RolesService;
      const auditLogWriter = yield* AuditLogWriter;
      return yield* respondJson(
        rolesService.create({
          ...dto,
          permissions: [...dto.permissions],
        }).pipe(
          Effect.tap((role) =>
            auditLogWriter.log({
              action: AuditAction.CREATE,
              entityType: AuditEntityType.ROLE,
              entityId: role.id,
            }),
          ),
        ),
        { status: 201 },
      );
    }),
  ),
  HttpRouter.put(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.ROLES, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(RolePathParamsSchema);
      const dto = yield* HttpServerRequest.schemaBodyJson(UpdateRoleSchema);
      const rolesService = yield* RolesService;
      const auditLogWriter = yield* AuditLogWriter;
      const permissions = dto.permissions ? [...dto.permissions] : undefined;
      const updateDto: UpdateRoleDto = {};
      if (dto.name !== undefined) {
        updateDto.name = dto.name;
      }
      if (dto.description !== undefined) {
        updateDto.description = dto.description;
      }
      if (permissions) {
        updateDto.permissions = permissions.map((permission) => ({
          resource: permission.resource,
          permission: permission.permission,
        }));
      }
      return yield* respondJson(
        rolesService.update(id, updateDto).pipe(
          Effect.tap(() =>
            auditLogWriter.log({
              action: AuditAction.UPDATE,
              entityType: AuditEntityType.ROLE,
              entityId: id,
            }),
          ),
        ),
      );
    }),
  ),
  HttpRouter.del(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.ROLES, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(RolePathParamsSchema);
      const rolesService = yield* RolesService;
      const auditLogWriter = yield* AuditLogWriter;
      return yield* respondEmpty(
        rolesService.delete(id).pipe(
          Effect.tap(() =>
            auditLogWriter.log({
              action: AuditAction.DELETE,
              entityType: AuditEntityType.ROLE,
              entityId: id,
            }),
          ),
        ),
        { status: 200 },
      );
    }),
  ),
  HttpRouter.prefixAll('/roles'),
);
