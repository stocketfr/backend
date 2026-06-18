import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { LocationType } from '@stocket/types/locations';
import { ClientStatus } from '@stocket/types/clients';
import { StockMovementReason } from '@stocket/types/stock-movements';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import * as s from '../platform/db/schema';
import type { DrizzleDb } from '../platform/db/drizzle';

const shortId = () => randomUUID().slice(0, 8);

/** Stable fake user UUID for test actor references (orders.created_by, etc.) */
export const TEST_USER_ID = '00000000-0000-4000-a000-000000000001';
export const TEST_USER_ID_2 = '00000000-0000-4000-a000-000000000002';

export async function ensureBetterAuthUserTable(db: DrizzleDb): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      email_verified BOOLEAN DEFAULT FALSE,
      image TEXT,
      role TEXT,
      locale TEXT,
      banned BOOLEAN DEFAULT FALSE,
      ban_reason TEXT,
      ban_expires TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      password TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "session" (
      id TEXT PRIMARY KEY,
      token TEXT,
      user_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function seedBetterAuthUser(
  db: DrizzleDb,
  overrides: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: 'admin' | 'user';
  },
  options: { readonly onConflict?: 'update' | 'nothing' } = {},
): Promise<void> {
  await ensureBetterAuthUserTable(db);

  const { id } = overrides;
  const name = overrides.name ?? 'Test User';
  const email = overrides.email ?? `${id}@example.com`;
  const role = overrides.role ?? 'user';

  if (options.onConflict === 'nothing') {
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, role, created_at, updated_at)
      VALUES (${id}, ${name}, ${email}, ${role}, NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    return;
  }

  await db.execute(sql`
    INSERT INTO "user" (id, name, email, role, created_at, updated_at)
    VALUES (${id}, ${name}, ${email}, ${role}, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      role = EXCLUDED.role,
      updated_at = EXCLUDED.updated_at
  `);
}

export async function seedCategory(
  db: DrizzleDb,
  overrides: Partial<typeof s.categories.$inferInsert> = {},
) {
  const [row] = await db
    .insert(s.categories)
    .values({ name: `Category-${shortId()}`, ...overrides })
    .returning();
  return row!;
}

export async function seedProduct(
  db: DrizzleDb,
  overrides: Partial<typeof s.products.$inferInsert> & { category_id: string },
) {
  const id = shortId();
  const [row] = await db
    .insert(s.products)
    .values({
      sku: `SKU-${id}`,
      name: `Product-${id}`,
      reorder_point: 10,
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedLocation(
  db: DrizzleDb,
  overrides: Partial<typeof s.locations.$inferInsert> = {},
) {
  const [row] = await db
    .insert(s.locations)
    .values({
      name: `Location-${shortId()}`,
      type: LocationType.WAREHOUSE,
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedArea(
  db: DrizzleDb,
  overrides: Partial<typeof s.areas.$inferInsert> & { location_id: string },
) {
  const [row] = await db
    .insert(s.areas)
    .values({ name: `Area-${shortId()}`, ...overrides })
    .returning();
  return row!;
}

export async function seedClient(
  db: DrizzleDb,
  overrides: Partial<typeof s.clients.$inferInsert> = {},
) {
  const id = shortId();
  const [row] = await db
    .insert(s.clients)
    .values({
      company_name: `Client-${id}`,
      contact_person: 'Test Person',
      email: `test-${id}@example.com`,
      account_status: ClientStatus.ACTIVE,
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedInventory(
  db: DrizzleDb,
  overrides: Partial<typeof s.inventory.$inferInsert> & {
    product_id: string;
    location_id: string;
  },
) {
  const [row] = await db
    .insert(s.inventory)
    .values({ quantity: 100, ...overrides })
    .returning();
  return row!;
}

export async function seedOrder(
  db: DrizzleDb,
  overrides: Partial<typeof s.orders.$inferInsert> & {
    client_id: string;
    created_by: string;
  },
) {
  const [row] = await db
    .insert(s.orders)
    .values({
      order_number: `ORD-TEST-${shortId()}`,
      delivery_address: '123 Test St',
      total_amount: 0,
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedOrderItems(
  db: DrizzleDb,
  items: (typeof s.orderItems.$inferInsert)[],
) {
  return db.insert(s.orderItems).values(items).returning();
}

export async function seedSupplier(
  db: DrizzleDb,
  overrides: Partial<typeof s.suppliers.$inferInsert> = {},
) {
  const id = shortId();
  const [row] = await db
    .insert(s.suppliers)
    .values({ name: `Supplier-${id}`, ...overrides })
    .returning();
  return row!;
}

export async function seedStockMovement(
  db: DrizzleDb,
  overrides: Partial<typeof s.stockMovements.$inferInsert> & {
    product_id: string;
    user_id: string;
  },
) {
  const [row] = await db
    .insert(s.stockMovements)
    .values({
      quantity: 10,
      reason: StockMovementReason.PURCHASE_RECEIVE,
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedAuditLog(
  db: DrizzleDb,
  overrides: Partial<typeof s.auditLogs.$inferInsert> = {},
) {
  const [row] = await db
    .insert(s.auditLogs)
    .values({
      action: AuditAction.CREATE,
      entity_type: AuditEntityType.PRODUCT,
      entity_id: randomUUID(),
      user_id: TEST_USER_ID,
      ...overrides,
    })
    .returning();
  return row!;
}
