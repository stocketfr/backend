import { sql } from 'drizzle-orm';
import { getProductionTenantBaseDomain } from '../tenancy/host';
import type { DrizzleDb } from './drizzle';

const LEGACY_PRODUCTION_TENANT_BASE_DOMAIN = 'librestock.maximilian.pw';
const LOCALHOST_TENANT_BASE_DOMAIN = 'localhost';
const LOCAL_TENANT_PORT = '3000';

export interface TenantDomainCleanupResult {
  readonly updated: number;
  readonly skippedConflicts: number;
}

type SqlResult = {
  readonly rows?: ReadonlyArray<{
    readonly updated?: unknown;
    readonly skipped_conflicts?: unknown;
  }>;
};

const toCount = (value: unknown): number => {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
};

/**
 * Local development used to inherit production-shaped primary subdomains from
 * the baseline SQL migration (for example `librestock.librestock.maximilian.pw`).
 * Normalize canonical generated subdomain rows to local tenant hostnames so the
 * platform tenant list opens `http://<slug>.localhost:3000` and never points a
 * local superadmin session at production.
 * Custom domains and non-primary domain rows are intentionally left alone.
 */
export async function normalizeDevelopmentTenantDomains(
  db: DrizzleDb,
): Promise<TenantDomainCleanupResult> {
  const currentProductionSuffix = `.${getProductionTenantBaseDomain()}`;
  const legacyProductionSuffix = `.${LEGACY_PRODUCTION_TENANT_BASE_DOMAIN}`;
  const localhostSuffix = `.${LOCALHOST_TENANT_BASE_DOMAIN}`;
  const localPortSuffix = `.${LOCALHOST_TENANT_BASE_DOMAIN}:${LOCAL_TENANT_PORT}`;
  const result = (await db.execute(sql`
    WITH candidates AS (
      SELECT
        td.id,
        lower(trim(trailing '.' from o.slug)) || ${localPortSuffix} AS local_hostname
      FROM tenant_domains td
      INNER JOIN organization o ON o.id = td.tenant_id
      WHERE td.kind = 'subdomain'
        AND td.is_primary = true
        AND td.hostname IN (
          lower(trim(trailing '.' from o.slug)) || ${currentProductionSuffix},
          lower(trim(trailing '.' from o.slug)) || ${legacyProductionSuffix},
          lower(trim(trailing '.' from o.slug)) || ${localhostSuffix},
          lower(trim(trailing '.' from o.slug))
        )
    ),
    updated AS (
      UPDATE tenant_domains td
      SET hostname = candidates.local_hostname
      FROM candidates
      WHERE td.id = candidates.id
        AND NOT EXISTS (
          SELECT 1
          FROM tenant_domains existing
          WHERE existing.hostname = candidates.local_hostname
            AND existing.id <> candidates.id
        )
      RETURNING td.id
    ),
    skipped_conflicts AS (
      SELECT candidates.id
      FROM candidates
      WHERE NOT EXISTS (
        SELECT 1
        FROM updated
        WHERE updated.id = candidates.id
      )
    )
    SELECT
      (SELECT count(*)::int FROM updated) AS updated,
      (SELECT count(*)::int FROM skipped_conflicts) AS skipped_conflicts
  `)) as SqlResult;

  const row = result.rows?.[0];
  return {
    updated: toCount(row?.updated),
    skippedConflicts: toCount(row?.skipped_conflicts),
  };
}
