import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DrizzleDb } from './drizzle';
import { members, organizations, tenantDomains } from './schema';
import type { AppConfigShape } from '../config/app-config';

export interface TenantRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

const tenantSelection = {
  id: organizations.id,
  name: organizations.name,
  slug: organizations.slug,
};

export const findTenantMembership = (
  db: DrizzleDb,
  userId: string,
  organizationId: string,
) =>
  db
    .select(tenantSelection)
    .from(organizations)
    .innerJoin(members, eq(members.organization_id, organizations.id))
    .where(
      and(eq(organizations.id, organizationId), eq(members.user_id, userId)),
    )
    .limit(1);

const localTenantHostnameCandidates = (
  hostname: string,
  appConfig: AppConfigShape,
) => {
  if (appConfig.isProduction || !hostname.endsWith('.localhost')) {
    return [hostname];
  }

  return [hostname, `${hostname}:3000`];
};

export const findTenantByHostname = (
  db: DrizzleDb,
  hostname: string,
  appConfig: AppConfigShape,
) =>
  db
    .select(tenantSelection)
    .from(organizations)
    .innerJoin(tenantDomains, eq(tenantDomains.tenant_id, organizations.id))
    .where(
      and(
        inArray(
          tenantDomains.hostname,
          localTenantHostnameCandidates(hostname, appConfig),
        ),
        isNotNull(tenantDomains.verified_at),
      ),
    )
    .limit(1);

export const findTenantBySlug = (db: DrizzleDb, slug: string) =>
  db
    .select(tenantSelection)
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);

export const findSingleTenantMembership = (db: DrizzleDb, userId: string) =>
  db
    .select(tenantSelection)
    .from(organizations)
    .innerJoin(members, eq(members.organization_id, organizations.id))
    .where(eq(members.user_id, userId))
    .orderBy(organizations.created_at)
    .limit(2);
