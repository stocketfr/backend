import type {
  CurrentUserResponseDto,
  ProfileResponseDto,
  SessionClaimsResponseDto,
} from '@stocket/types/auth';
import type { UserSession } from '../../platform/auth/user-session';
import {
  getSessionIdFromSession,
  getSessionTimingFromSession,
  getUserIdFromSession,
} from '../../platform/auth/session';
import type { UserPermissions } from '../roles/service';
import type { TenantContext } from '../../platform/tenancy/tenant-context';

export const toCurrentUserResponse = (
  session: UserSession,
  userPermissions: UserPermissions,
  tenant: TenantContext,
): CurrentUserResponseDto => {
  const { id, name, email, image } = session.user;

  return {
    id,
    name,
    email,
    image: image ?? undefined,
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    tenantSlug: tenant.tenantSlug,
    roles: userPermissions.roleNames,
    permissions: userPermissions.permissions,
  };
};

export const toProfileResponse = (session: UserSession): ProfileResponseDto => {
  const { id, name, email, image, createdAt, updatedAt } = session.user;

  return {
    id,
    name,
    email,
    image: image ?? undefined,
    createdAt:
      createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
    updatedAt:
      updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt),
  };
};

export const toSessionClaimsResponse = (
  session: UserSession,
): SessionClaimsResponseDto => {
  const { issuedAt, expiresAt } = getSessionTimingFromSession(session);

  return {
    user_id: getUserIdFromSession(session) ?? '',
    session_id: getSessionIdFromSession(session) ?? '',
    expires_at: expiresAt ?? 0,
    issued_at: issuedAt ?? 0,
  };
};
