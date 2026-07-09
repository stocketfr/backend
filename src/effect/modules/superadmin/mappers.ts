import type {
  SuperAdminMeResponse,
  SuperAdminTenantListResponse,
} from '@stocket/types/superadmin';
import type { UserSession } from '../../platform/auth/user-session';
import type { TenantListRow } from './types';

export const toSuperAdminMeResponse = (
  session: UserSession,
): SuperAdminMeResponse => ({
  id: session.user.id,
  email: session.user.email ?? '',
  name: session.user.name ?? '',
  isSuperAdmin: true,
});

export const toSuperAdminTenantListResponse = (
  rows: readonly TenantListRow[],
): SuperAdminTenantListResponse => ({
  data: rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    primaryHostname: row.primaryHostname,
    createdAt: row.createdAt.toISOString(),
  })),
});
