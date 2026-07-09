import { type Permission, type Resource } from '@stocket/types/auth';
import type { RoleResponseDto } from '@stocket/types/roles';
import type { roles, rolePermissions } from '../../platform/db/schema';

type RoleRow = typeof roles.$inferSelect;
type RolePermissionRow = typeof rolePermissions.$inferSelect;

export interface RoleWithPermissions extends RoleRow {
  permissions: RolePermissionRow[];
}

export function toRoleResponseDto(
  entity: RoleWithPermissions,
): RoleResponseDto {
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    is_system: entity.is_system,
    permissions: (entity.permissions ?? []).map((p) => ({
      resource: p.resource as Resource,
      permission: p.permission as Permission,
    })),
    created_at: entity.created_at,
    updated_at: entity.updated_at,
  };
}
