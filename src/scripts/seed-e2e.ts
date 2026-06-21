import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { defaultRoleSeedDefinitions } from '../effect/platform/seed/default-roles';
import { getDatabaseUrl } from '../config/db-connection.utils';
import { readOptionalEnv } from '../config/env.utils';

const DEFAULT_E2E_TENANT_NAME = 'E2E Tenant';
const DEFAULT_E2E_TENANT_SLUG = 'e2e';
const DEFAULT_E2E_USER_EMAIL = 'e2e-test@stocket.local';

type UserRow = { id: string };
type TenantRow = { id: string };
type RoleRow = { id: string };
type SeedRow = { id: string };

export interface SeedE2eTenantOptions {
  readonly databaseUrl?: string;
  readonly tenantName?: string;
  readonly tenantSlug?: string;
  readonly tenantHostname?: string;
  readonly userEmail?: string;
}

export interface SeedE2eTenantResult {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly tenantHostname: string;
  readonly userEmail: string;
}

function databaseUrl(explicitDatabaseUrl?: string): string {
  return (
    explicitDatabaseUrl?.trim() ||
    readOptionalEnv('E2E_DATABASE_URL') ||
    getDatabaseUrl()
  );
}

function resolveSeedConfig(options: SeedE2eTenantOptions) {
  const tenantSlug =
    options.tenantSlug ??
    process.env.E2E_TENANT_SLUG ??
    DEFAULT_E2E_TENANT_SLUG;

  return {
    databaseUrl: databaseUrl(options.databaseUrl),
    tenantName:
      options.tenantName ??
      process.env.E2E_TENANT_NAME ??
      DEFAULT_E2E_TENANT_NAME,
    tenantSlug,
    tenantHostname:
      options.tenantHostname ??
      process.env.E2E_TENANT_HOSTNAME ??
      `${tenantSlug}.localhost:3000`,
    userEmail: (
      options.userEmail ??
      process.env.E2E_USER_EMAIL ??
      DEFAULT_E2E_USER_EMAIL
    )
      .trim()
      .toLowerCase(),
  };
}

export async function seedE2eTenant(
  options: SeedE2eTenantOptions = {},
): Promise<SeedE2eTenantResult> {
  const config = resolveSeedConfig(options);
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query<UserRow>(
      'SELECT id FROM "user" WHERE lower(email) = $1 LIMIT 1',
      [config.userEmail],
    );
    const userId = userResult.rows[0]?.id;
    if (!userId) {
      throw new Error(
        `E2E auth user ${config.userEmail} does not exist. Create it before seeding the tenant.`,
      );
    }

    // The user was created through the public sign-up endpoint, so it starts
    // unverified; with requireEmailVerification enabled, sign-in would 403.
    await client.query(
      'UPDATE "user" SET email_verified = true WHERE id = $1',
      [userId],
    );

    const tenantResult = await client.query<TenantRow>(
      `
        INSERT INTO organization (id, name, slug)
        VALUES ($1, $2, $3)
        ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name
        RETURNING id
      `,
      [randomUUID(), config.tenantName, config.tenantSlug],
    );
    const tenantId = tenantResult.rows[0]!.id;

    await client.query(
      `
        INSERT INTO tenant_domains (tenant_id, hostname, kind, is_primary, verified_at)
        VALUES ($1, $2, 'subdomain', true, NOW())
        ON CONFLICT (hostname) DO UPDATE
        SET tenant_id = EXCLUDED.tenant_id,
            kind = EXCLUDED.kind,
            is_primary = EXCLUDED.is_primary,
            verified_at = EXCLUDED.verified_at
      `,
      [tenantId, config.tenantHostname],
    );

    for (const seed of defaultRoleSeedDefinitions) {
      const roleResult = await client.query<RoleRow>(
        `
          INSERT INTO roles (tenant_id, name, description, is_system)
          VALUES ($1, $2, $3, true)
          ON CONFLICT (tenant_id, name) DO UPDATE
          SET description = EXCLUDED.description,
              is_system = EXCLUDED.is_system
          RETURNING id
        `,
        [tenantId, seed.name, seed.description],
      );
      const roleId = roleResult.rows[0]!.id;

      for (const permission of seed.permissions) {
        await client.query(
          `
            INSERT INTO role_permissions (role_id, resource, permission)
            VALUES ($1, $2, $3)
            ON CONFLICT (role_id, resource, permission) DO NOTHING
          `,
          [roleId, permission.resource, permission.permission],
        );
      }
    }

    await client.query(
      `
        INSERT INTO member (id, organization_id, user_id, role)
        VALUES ($1, $2, $3, 'member')
        ON CONFLICT (user_id, organization_id) DO NOTHING
      `,
      [randomUUID(), tenantId, userId],
    );

    const adminRoleResult = await client.query<RoleRow>(
      `
        SELECT id FROM roles
        WHERE tenant_id = $1 AND name = 'Admin'
        LIMIT 1
      `,
      [tenantId],
    );
    const adminRoleId = adminRoleResult.rows[0]?.id;
    if (!adminRoleId) {
      throw new Error('E2E Admin role was not seeded.');
    }

    await client.query(
      `
        INSERT INTO user_roles (tenant_id, user_id, role_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING
      `,
      [tenantId, userId, adminRoleId],
    );

    const customRoleResult = await client.query<RoleRow>(
      `
        INSERT INTO roles (tenant_id, name, description, is_system)
        VALUES ($1, 'E2E Custom Role', 'Custom role for E2E tests', false)
        ON CONFLICT (tenant_id, name) DO UPDATE
        SET description = EXCLUDED.description,
            is_system = false
        RETURNING id
      `,
      [tenantId],
    );
    const customRoleId = customRoleResult.rows[0]!.id;
    await client.query(
      `
        INSERT INTO role_permissions (role_id, resource, permission)
        VALUES ($1, 'dashboard', 'read')
        ON CONFLICT (role_id, resource, permission) DO NOTHING
      `,
      [customRoleId],
    );

    const categoryResult = await client.query<SeedRow>(
      `
        WITH existing AS (
          SELECT id FROM categories WHERE tenant_id = $1 AND name = 'E2E Category' LIMIT 1
        ), inserted AS (
          INSERT INTO categories (tenant_id, name, description)
          SELECT $1, 'E2E Category', 'Seed category for E2E tests'
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          RETURNING id
        )
        SELECT id FROM inserted
        UNION ALL
        SELECT id FROM existing
        LIMIT 1
      `,
      [tenantId],
    );
    const categoryId = categoryResult.rows[0]!.id;

    const locationResult = await client.query<SeedRow>(
      `
        WITH existing AS (
          SELECT id FROM locations WHERE tenant_id = $1 AND name = 'E2E Seed Location' LIMIT 1
        ), inserted AS (
          INSERT INTO locations (tenant_id, name, type, address, contact_person, phone, is_active)
          SELECT $1, 'E2E Seed Location', 'WAREHOUSE', '123 E2E Street', 'E2E Contact', '+49 000 000', true
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          RETURNING id
        )
        SELECT id FROM inserted
        UNION ALL
        SELECT id FROM existing
        LIMIT 1
      `,
      [tenantId],
    );
    const locationId = locationResult.rows[0]!.id;
    await client.query(
      `
        UPDATE locations
        SET name = 'E2E Seed Location',
            type = 'WAREHOUSE',
            address = '123 E2E Street',
            contact_person = 'E2E Contact',
            phone = '+49 000 000',
            is_active = true,
            updated_at = NOW()
        WHERE id = $1
      `,
      [locationId],
    );

    const areaResult = await client.query<SeedRow>(
      `
        WITH existing AS (
          SELECT id FROM areas WHERE tenant_id = $1 AND location_id = $2 AND name = 'E2E Seed Area' LIMIT 1
        ), inserted AS (
          INSERT INTO areas (tenant_id, location_id, name, code, description, is_active)
          SELECT $1, $2, 'E2E Seed Area', 'E2E-A1', 'Seed area for E2E tests', true
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          RETURNING id
        )
        SELECT id FROM inserted
        UNION ALL
        SELECT id FROM existing
        LIMIT 1
      `,
      [tenantId, locationId],
    );
    const areaId = areaResult.rows[0]!.id;
    await client.query(
      `
        UPDATE areas
        SET name = 'E2E Seed Area',
            code = 'E2E-A1',
            description = 'Seed area for E2E tests',
            is_active = true,
            updated_at = NOW()
        WHERE id = $1
      `,
      [areaId],
    );

    const supplierResult = await client.query<SeedRow>(
      `
        WITH existing AS (
          SELECT id FROM suppliers WHERE tenant_id = $1 AND name = 'E2E Seed Supplier' LIMIT 1
        ), inserted AS (
          INSERT INTO suppliers (tenant_id, name, contact_person, email, phone, address, is_active)
          SELECT $1, 'E2E Seed Supplier', 'E2E Supplier Contact', 'e2e-seed-supplier@example.com', '+49 111 111', 'Supplier Street', true
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          RETURNING id
        )
        SELECT id FROM inserted
        UNION ALL
        SELECT id FROM existing
        LIMIT 1
      `,
      [tenantId],
    );
    const supplierId = supplierResult.rows[0]!.id;
    await client.query(
      `
        UPDATE suppliers
        SET name = 'E2E Seed Supplier',
            contact_person = 'E2E Supplier Contact',
            email = 'e2e-seed-supplier@example.com',
            phone = '+49 111 111',
            address = 'Supplier Street',
            is_active = true,
            updated_at = NOW()
        WHERE id = $1
      `,
      [supplierId],
    );

    const clientResult = await client.query<SeedRow>(
      `
        WITH existing AS (
          SELECT id FROM clients WHERE tenant_id = $1 AND email = 'e2e-seed-client@example.com' LIMIT 1
        ), inserted AS (
          INSERT INTO clients (tenant_id, company_name, yacht_name, contact_person, email, phone, billing_address, default_delivery_address, account_status)
          SELECT $1, 'E2E Seed Client', 'E2E Yacht', 'E2E Client Contact', 'e2e-seed-client@example.com', '+49 222 222', 'Billing Street', 'Delivery Street', 'ACTIVE'
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          RETURNING id
        )
        SELECT id FROM inserted
        UNION ALL
        SELECT id FROM existing
        LIMIT 1
      `,
      [tenantId],
    );
    const clientId = clientResult.rows[0]!.id;
    await client.query(
      `
        UPDATE clients
        SET company_name = 'E2E Seed Client',
            yacht_name = 'E2E Yacht',
            contact_person = 'E2E Client Contact',
            email = 'e2e-seed-client@example.com',
            phone = '+49 222 222',
            billing_address = 'Billing Street',
            default_delivery_address = 'Delivery Street',
            account_status = 'ACTIVE',
            updated_at = NOW()
        WHERE id = $1
      `,
      [clientId],
    );

    const productResult = await client.query<SeedRow>(
      `
        INSERT INTO products (tenant_id, sku, name, description, category_id, reorder_point, primary_supplier_id, unit, is_active, is_perishable)
        VALUES ($1, 'E2E-SEED-PRODUCT', 'E2E Seed Product', 'Seed product for E2E tests', $2, 10, $3, 'pcs', true, false)
        ON CONFLICT (tenant_id, sku) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            category_id = EXCLUDED.category_id,
            reorder_point = EXCLUDED.reorder_point,
            primary_supplier_id = EXCLUDED.primary_supplier_id,
            is_active = true,
            deleted_at = NULL
        RETURNING id
      `,
      [tenantId, categoryId, supplierId],
    );
    const productId = productResult.rows[0]!.id;

    const inventoryResult = await client.query<SeedRow>(
      `
        WITH existing AS (
          SELECT id FROM inventory
          WHERE tenant_id = $1 AND product_id = $2 AND location_id = $3 AND area_id = $4
          LIMIT 1
        ), inserted AS (
          INSERT INTO inventory (tenant_id, product_id, location_id, area_id, quantity, batch_number, cost_per_unit, received_date)
          SELECT $1, $2, $3, $4, 25, 'E2E-BATCH-001', 12.50, NOW()
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          RETURNING id
        )
        SELECT id FROM inserted
        UNION ALL
        SELECT id FROM existing
        LIMIT 1
      `,
      [tenantId, productId, locationId, areaId],
    );
    const inventoryId = inventoryResult.rows[0]!.id;

    await client.query(
      `
        UPDATE inventory
        SET quantity = 25, batch_number = 'E2E-BATCH-001', updated_at = NOW()
        WHERE id = $1
      `,
      [inventoryId],
    );

    const orderResult = await client.query<SeedRow>(
      `
        INSERT INTO orders (tenant_id, order_number, client_id, status, delivery_address, yacht_name, total_amount, created_by)
        VALUES ($1, 'E2E-ORDER-001', $2, 'DRAFT', 'Delivery Street', 'E2E Yacht', 25.00, $3)
        ON CONFLICT (tenant_id, order_number) DO UPDATE
        SET client_id = EXCLUDED.client_id,
            status = 'DRAFT',
            delivery_address = EXCLUDED.delivery_address,
            yacht_name = EXCLUDED.yacht_name,
            total_amount = EXCLUDED.total_amount
        RETURNING id
      `,
      [tenantId, clientId, userId],
    );
    const orderId = orderResult.rows[0]!.id;

    await client.query(
      `
        INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
        SELECT $1, $2, 1, 25.00, 25.00
        WHERE NOT EXISTS (
          SELECT 1 FROM order_items WHERE order_id = $1 AND product_id = $2
        )
      `,
      [orderId, productId],
    );

    await client.query(
      `
        INSERT INTO stock_movements (tenant_id, product_id, to_location_id, quantity, reason, notes, user_id)
        SELECT $1, $2, $3, 25, 'PURCHASE_RECEIVE', 'E2E seed movement', $4
        WHERE NOT EXISTS (
          SELECT 1 FROM stock_movements
          WHERE tenant_id = $1 AND product_id = $2 AND to_location_id = $3 AND reason = 'PURCHASE_RECEIVE'
        )
      `,
      [tenantId, productId, locationId, userId],
    );

    await client.query('COMMIT');
    return {
      tenantId,
      tenantSlug: config.tenantSlug,
      tenantHostname: config.tenantHostname,
      userEmail: config.userEmail,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const isDirectRun = /seed-e2e\.[jt]s$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  void seedE2eTenant()
    .then(({ tenantSlug, tenantHostname, userEmail }) => {
      console.log(
        `Seeded E2E tenant ${tenantSlug} (${tenantHostname}) for ${userEmail}.`,
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
