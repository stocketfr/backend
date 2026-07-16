import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import { Effect } from 'effect';
import { eq } from 'drizzle-orm';
import type { Permission, Resource } from '@stocket/types/auth';
import { ErrorCode } from '@stocket/types/common';
import { DrizzleDatabase } from '../db/drizzle';
import { superAdmins } from '../db/schema';
import { PermissionProvider } from './permission-provider';
import {
  ForbiddenError,
  InternalError,
  NotFoundError,
} from '../effect/domain-errors';
import { isPlatformHost, resolveRequestHost } from '../tenancy/host';
import { requireSession } from '../http/session';
import { CurrentRequestActor } from './request-actor';
import {
  getRequestTenantId,
  resolveTenantForSession,
} from '../tenancy/tenant-context';

export class PermissionDenied extends ForbiddenError(
  'PermissionDenied',
  ErrorCode.PERMISSION_DENIED,
) {}
export class PlatformHostRequired extends NotFoundError(
  'PlatformHostRequired',
)<{
  readonly host?: string | null;
}> {}
export class SuperAdminDenied extends ForbiddenError('SuperAdminDenied') {}
export class SuperAdminInfrastructureError extends InternalError(
  'SuperAdminInfrastructureError',
)<{
  readonly cause?: unknown;
}> {}

const requirePermissionForIdentity = (
  userId: string,
  tenantId: string,
  resource: Resource,
  permission: Permission,
) =>
  Effect.gen(function* () {
    const permissionProvider = yield* PermissionProvider;
    const { permissions } = yield* permissionProvider.getPermissionsForUser(
      userId,
      tenantId,
    );

    yield* Effect.succeed(
      permissions[resource]?.includes(permission) ?? false,
    ).pipe(
      Effect.filterOrFail(
        Boolean,
        () =>
          new PermissionDenied({
            messageKey: 'auth.permissionDenied',
          }),
      ),
    );
  });

export const requirePermission = (resource: Resource, permission: Permission) =>
  Effect.gen(function* () {
    const session = yield* requireSession;
    const tenantId =
      (yield* getRequestTenantId) ??
      (yield* resolveTenantForSession(session)).tenantId;
    yield* requirePermissionForIdentity(
      session.user.id,
      tenantId,
      resource,
      permission,
    );
  });

export const requireRequestActorPermission = (
  resource: Resource,
  permission: Permission,
) =>
  Effect.flatMap(CurrentRequestActor, (actor) =>
    requirePermissionForIdentity(
      actor.userId,
      actor.tenantId,
      resource,
      permission,
    ),
  );

export const requireSuperAdmin = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const host = resolveRequestHost(request);

  if (!isPlatformHost(host)) {
    return yield* Effect.fail(
      new PlatformHostRequired({
        host,
        messageKey: 'platform.hostRequired',
      }),
    );
  }

  const session = yield* requireSession;
  const db = yield* DrizzleDatabase;
  const rows = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ user_id: superAdmins.user_id })
        .from(superAdmins)
        .where(eq(superAdmins.user_id, session.user.id))
        .limit(1),
    catch: (cause) =>
      new SuperAdminInfrastructureError({
        cause,
        messageKey: 'superadmin.infrastructureFailed',
      }),
  });

  if (!rows[0]) {
    return yield* Effect.fail(
      new SuperAdminDenied({ messageKey: 'superadmin.forbidden' }),
    );
  }

  return session;
});
