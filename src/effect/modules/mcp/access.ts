import { Effect } from 'effect';
import type { Permission, Resource } from '@stocket/types/auth';
import { PermissionDenied } from '../../platform/auth/authorization';
import {
  PermissionProvider,
  type UserPermissions,
} from '../../platform/auth/permission-provider';
import {
  CurrentRequestActor,
  type RequestActor,
} from '../../platform/auth/request-actor';

export interface McpPermissionRequirement {
  readonly resource: Resource;
  readonly permission: Permission;
}

export interface McpToolAccess {
  readonly permissions: readonly McpPermissionRequirement[];
}

export type McpAccessRequirements = PermissionProvider | RequestActor;

export const loadMcpAccessSnapshot = Effect.gen(function* () {
  const actor = yield* CurrentRequestActor;
  const permissionProvider = yield* PermissionProvider;
  return yield* permissionProvider.getPermissionsForUser(
    actor.userId,
    actor.tenantId,
  );
});

export const isMcpToolAllowed = (
  access: McpToolAccess,
  snapshot: UserPermissions,
): boolean =>
  access.permissions.every(({ resource, permission }) =>
    snapshot.permissions[resource]?.includes(permission),
  );

export const requireMcpToolAccess = (access: McpToolAccess) =>
  loadMcpAccessSnapshot.pipe(
    Effect.filterOrFail(
      (snapshot) => isMcpToolAllowed(access, snapshot),
      () =>
        new PermissionDenied({
          messageKey: 'auth.permissionDenied',
        }),
    ),
    Effect.asVoid,
  );
