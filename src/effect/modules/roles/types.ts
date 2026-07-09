import type { roles, rolePermissions } from '../../platform/db/schema';

export type RoleRow = typeof roles.$inferSelect;
export type RolePermissionRow = typeof rolePermissions.$inferSelect;

export interface RoleWithPermissions extends RoleRow {
  readonly permissions: readonly RolePermissionRow[];
}
