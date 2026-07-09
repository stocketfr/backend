import { HttpRouter } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { Permission, Resource } from '@stocket/types/auth';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import {
  CreateRoleSchema,
  RoleIdSchema,
  UpdateRoleSchema,
  type UpdateRoleDto,
} from '@stocket/types/roles';
import {
  emptyInput,
  jsonBody,
  pathParams,
  pathParamsAndJsonBody,
  tenantRouteContext,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { RolesService } from './service';

const RolePathParamsSchema = Schema.Struct({
  id: RoleIdSchema,
});

export const rolesRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    tenantRoute({
      permissions: [[Resource.ROLES, Permission.READ]],
      decode: emptyInput,
      handler: () =>
        Effect.flatMap(RolesService, (rolesService) => rolesService.findAll()),
    }),
  ),
  HttpRouter.get(
    '/:id',
    tenantRoute({
      permissions: [[Resource.ROLES, Permission.READ]],
      decode: pathParams(RolePathParamsSchema),
      handler: ({ input: { id } }) =>
        Effect.flatMap(RolesService, (rolesService) =>
          rolesService.findById(id),
        ),
    }),
  ),
  HttpRouter.post(
    '/',
    tenantRouteContext({
      permissions: [[Resource.ROLES, Permission.WRITE]],
      decode: jsonBody(CreateRoleSchema),
    }).pipe(
      Effect.flatMap(({ input: dto }) =>
        respondAuditedMutation(
          Effect.flatMap(RolesService, (rolesService) =>
            rolesService.create({
              ...dto,
              permissions: [...dto.permissions],
            }),
          ),
          {
            action: AuditAction.CREATE,
            entityType: AuditEntityType.ROLE,
            entityId: (role) => role.id,
            responseOptions: { status: 201 },
          },
        ),
      ),
    ),
  ),
  HttpRouter.put(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.ROLES, Permission.WRITE]],
      decode: pathParamsAndJsonBody(RolePathParamsSchema, UpdateRoleSchema),
    }).pipe(
      Effect.flatMap(({ input: { path, body: dto } }) =>
        respondAuditedMutation(
          Effect.flatMap(RolesService, (rolesService) => {
            const permissions = dto.permissions
              ? [...dto.permissions]
              : undefined;
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
            return rolesService.update(path.id, updateDto);
          }),
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.ROLE,
            entityId: path.id,
          },
        ),
      ),
    ),
  ),
  HttpRouter.del(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.ROLES, Permission.WRITE]],
      decode: pathParams(RolePathParamsSchema),
    }).pipe(
      Effect.flatMap(({ input: { id } }) =>
        respondAuditedMutation(
          Effect.flatMap(RolesService, (rolesService) =>
            rolesService.delete(id),
          ),
          {
            action: AuditAction.DELETE,
            entityType: AuditEntityType.ROLE,
            entityId: id,
            response: 'empty',
            responseOptions: { status: 200 },
          },
        ),
      ),
    ),
  ),
  HttpRouter.prefixAll('/roles'),
);
