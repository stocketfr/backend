import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, truncateAll } from '../../testing/integration-layer';
import { normalizeDevelopmentTenantDomains } from './dev-tenant-domain-cleanup';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const CUSTOM_TENANT_ID = '10000000-0000-4000-8000-000000000002';

describe('normalizeDevelopmentTenantDomains', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('rewrites canonical production-shaped primary subdomains to localhost with the dev port', async () => {
    const db = getTestDb();

    await db.execute(sql`
      INSERT INTO organization (id, name, slug)
      VALUES
        (${TENANT_ID}, 'LibreStock', 'librestock'),
        (${CUSTOM_TENANT_ID}, 'Custom Tenant', 'custom-tenant')
    `);
    await db.execute(sql`
      INSERT INTO tenant_domains (tenant_id, hostname, kind, is_primary, verified_at)
      VALUES
        (${TENANT_ID}, 'librestock.librestock.maximilian.pw', 'subdomain', true, now()),
        (${CUSTOM_TENANT_ID}, 'inventory.example.com', 'custom_domain', true, now())
    `);

    await expect(normalizeDevelopmentTenantDomains(db)).resolves.toEqual({
      updated: 1,
      skippedConflicts: 0,
    });

    const { rows } = (await db.execute(sql`
      SELECT hostname
      FROM tenant_domains
      ORDER BY hostname
    `)) as { rows: Array<{ hostname: string }> };

    expect(rows.map((row) => row.hostname)).toEqual([
      'inventory.example.com',
      'librestock.localhost:3000',
    ]);
  });

  it('rewrites old localhost-subdomain rows to include the dev port', async () => {
    const db = getTestDb();

    await db.execute(sql`
      INSERT INTO organization (id, name, slug)
      VALUES (${TENANT_ID}, 'LibreStock', 'librestock')
    `);
    await db.execute(sql`
      INSERT INTO tenant_domains (tenant_id, hostname, kind, is_primary, verified_at)
      VALUES (${TENANT_ID}, 'librestock.localhost', 'subdomain', true, now())
    `);

    await expect(normalizeDevelopmentTenantDomains(db)).resolves.toEqual({
      updated: 1,
      skippedConflicts: 0,
    });

    const { rows } = (await db.execute(sql`
      SELECT hostname
      FROM tenant_domains
    `)) as { rows: Array<{ hostname: string }> };

    expect(rows[0]?.hostname).toBe('librestock.localhost:3000');
  });

  it('leaves conflicting local hostnames untouched instead of failing startup', async () => {
    const db = getTestDb();

    await db.execute(sql`
      INSERT INTO organization (id, name, slug)
      VALUES (${TENANT_ID}, 'LibreStock', 'librestock')
    `);
    await db.execute(sql`
      INSERT INTO tenant_domains (tenant_id, hostname, kind, is_primary, verified_at)
      VALUES (${TENANT_ID}, 'librestock.librestock.maximilian.pw', 'subdomain', true, now())
    `);
    await db.execute(sql`
      INSERT INTO tenant_domains (tenant_id, hostname, kind, is_primary, verified_at)
      VALUES (${TENANT_ID}, 'librestock.localhost:3000', 'subdomain', false, now())
    `);

    await expect(normalizeDevelopmentTenantDomains(db)).resolves.toEqual({
      updated: 0,
      skippedConflicts: 1,
    });
  });
});
