import { LocationType } from '@stocket/types/locations';
import { eq, sql } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import {
  auditLogs,
  stockMovements,
  orders,
  inventory,
  supplierProducts,
  areas,
  locations,
  clients,
  products,
  suppliers,
  categories,
  organizations,
} from '../../effect/platform/db/schema';
import { DEFAULT_TENANT_ID } from '../../effect/platform/tenant-constants';
import {
  getDbConnectionParams,
  getPoolMax,
  getSSLConfig,
  IDLE_TIMEOUT_MS,
} from '../../config/db-connection.utils';
import type { SeedTenant } from './seeder.interface';

export const MOCK_USER_ID = '00000000-0000-0000-0000-000000000001';

export interface SeedOptions {
  tenantId?: string;
  tenantSlug?: string;
  help: boolean;
}

export const SEED_CONFIG = {
  categories: { root: 10, children: 3 },
  suppliers: 20,
  products: 100,
  locations: 8,
  areasPerLocation: 4,
  subAreasPerArea: 2,
  clients: 15,
  inventoryRecords: 200,
  orders: 30,
  itemsPerOrder: { min: 1, max: 6 },
  stockMovements: 80,
  auditLogs: 100,
  supplierProducts: 60,
};

export const YACHT_CATEGORIES = {
  root: [
    'Galley & Provisions',
    'Deck & Exterior',
    'Electronics & Navigation',
    'Safety Equipment',
    'Engine Room',
    'Interior & Accommodation',
    'Water Sports',
    'Cleaning & Maintenance',
    'Medical Supplies',
    'Office & Administration',
  ],
  children: {
    'Galley & Provisions': [
      'Beverages',
      'Dry Goods',
      'Fresh Produce',
      'Frozen Foods',
      'Cookware',
      'Tableware',
    ],
    'Deck & Exterior': [
      'Ropes & Lines',
      'Fenders',
      'Anchoring',
      'Deck Hardware',
      'Lighting',
    ],
    'Electronics & Navigation': [
      'GPS & Chartplotters',
      'Communication',
      'Entertainment',
      'Instruments',
    ],
    'Safety Equipment': [
      'Life Jackets',
      'Fire Safety',
      'First Aid',
      'Emergency Signals',
    ],
    'Engine Room': [
      'Fuel Systems',
      'Lubricants',
      'Filters',
      'Tools',
      'Spare Parts',
    ],
    'Interior & Accommodation': [
      'Linens & Bedding',
      'Furniture',
      'Lighting',
      'Decor',
    ],
    'Water Sports': [
      'Diving Equipment',
      'Snorkeling',
      'Toys & Inflatables',
      'Fishing Gear',
    ],
    'Cleaning & Maintenance': [
      'Cleaning Supplies',
      'Polishes & Waxes',
      'Paints & Coatings',
      'Hand Tools',
    ],
    'Medical Supplies': ['Medications', 'First Aid', 'Personal Care'],
    'Office & Administration': ['Stationery', 'Documentation', 'Storage'],
  },
};

export const YACHT_NAMES = [
  'Lady Aurora',
  'Sea Breeze',
  'Ocean Pearl',
  'Silver Wave',
  'Blue Horizon',
  'Golden Star',
  'Crystal Sea',
  'Wind Dancer',
  "Neptune's Grace",
  'Poseidon',
  'Coral Reef',
  'Sunset Voyager',
  'Mystic Tide',
  'Azure Dream',
  'Storm Chaser',
];

export const LOCATION_NAMES: { name: string; type: LocationType }[] = [
  { name: 'Main Warehouse - Port Hercule', type: LocationType.WAREHOUSE },
  { name: 'Cold Storage Facility', type: LocationType.WAREHOUSE },
  { name: 'Dry Goods Warehouse', type: LocationType.WAREHOUSE },
  { name: 'Electronics Workshop', type: LocationType.WAREHOUSE },
  { name: 'In-Transit Staging', type: LocationType.IN_TRANSIT },
  { name: 'Marina Delivery Point', type: LocationType.CLIENT },
  { name: 'Supplier Dropoff - Nice', type: LocationType.SUPPLIER },
  { name: 'Supplier Dropoff - Antibes', type: LocationType.SUPPLIER },
];

export const AREA_TEMPLATES: Record<string, string[]> = {
  warehouse: [
    'Aisle A',
    'Aisle B',
    'Aisle C',
    'Receiving Dock',
    'Packing Area',
    'Returns Zone',
  ],
  cold_storage: [
    'Freezer Section',
    'Chiller Section',
    'Fresh Produce Bay',
    'Dairy Section',
  ],
  workshop: [
    'Workbench Area',
    'Testing Station',
    'Component Racks',
    'Shipping Prep',
  ],
};

export const SUB_AREA_TEMPLATES = [
  'Shelf 1',
  'Shelf 2',
  'Shelf 3',
  'Bin A',
  'Bin B',
  'Rack Top',
  'Rack Bottom',
  'Floor Level',
  'Pallet Zone',
];

export function buildSeedPoolConfig(): pg.PoolConfig {
  const ssl = getSSLConfig() || undefined;
  const max = getPoolMax();
  const seedDatabaseUrl = process.env.SEED_DATABASE_URL;

  if (seedDatabaseUrl) {
    return {
      connectionString: seedDatabaseUrl,
      ssl,
      max,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
    };
  }

  const connParams = getDbConnectionParams();

  if ('url' in connParams) {
    return {
      connectionString: connParams.url,
      ssl,
      max,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
    };
  }

  return {
    host: connParams.host,
    port: connParams.port,
    user: connParams.user,
    password: connParams.password,
    database: connParams.database,
    ssl,
    max,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  };
}

export async function createDatabase(): Promise<NodePgDatabase> {
  const pool = new pg.Pool(buildSeedPoolConfig());
  try {
    const client = await pool.connect();
    client.release();
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  return drizzle(pool);
}

const takeValue = (args: string[], index: number, flag: string) => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

export const readSeedOptions = (
  args = process.argv.slice(2),
  env = process.env,
): SeedOptions => {
  let tenantId = env.SEED_TENANT_ID?.trim() || undefined;
  let tenantSlug = env.SEED_TENANT_SLUG?.trim() || undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--tenant-id') {
      tenantId = takeValue(args, i, arg);
      tenantSlug = undefined;
      i++;
      continue;
    }

    if (arg.startsWith('--tenant-id=')) {
      tenantId = arg.slice('--tenant-id='.length);
      tenantSlug = undefined;
      continue;
    }

    if (arg === '--tenant-slug') {
      tenantSlug = takeValue(args, i, arg);
      tenantId = undefined;
      i++;
      continue;
    }

    if (arg.startsWith('--tenant-slug=')) {
      tenantSlug = arg.slice('--tenant-slug='.length);
      tenantId = undefined;
      continue;
    }

    if (arg === '--tenant') {
      const value = takeValue(args, i, arg);
      if (isUuid(value)) {
        tenantId = value;
        tenantSlug = undefined;
      } else {
        tenantSlug = value;
        tenantId = undefined;
      }
      i++;
      continue;
    }

    if (arg.startsWith('--tenant=')) {
      const value = arg.slice('--tenant='.length);
      if (isUuid(value)) {
        tenantId = value;
        tenantSlug = undefined;
      } else {
        tenantSlug = value;
        tenantId = undefined;
      }
      continue;
    }

    throw new Error(`Unknown seed option: ${arg}`);
  }

  if (help) {
    return { help };
  }

  if (tenantId && tenantSlug) {
    throw new Error(
      'Set only one tenant target: --tenant-id, --tenant-slug, or --tenant',
    );
  }

  return {
    tenantId,
    tenantSlug,
    help,
  };
};

export const seedUsage = `Usage:
  pnpm seed
  pnpm seed -- --tenant-slug <slug>
  pnpm seed -- --tenant-id <uuid>
  pnpm seed:workspace -- --tenant-slug <slug>
  SEED_TENANT_SLUG=<slug> pnpm seed
  SEED_DATABASE_URL=<url> pnpm seed -- --tenant-slug <slug>

Options:
  --tenant <uuid-or-slug>  Resolve the seed target by UUID or slug.
  --tenant-id <uuid>      Seed data for an existing tenant id.
  --tenant-slug <slug>    Seed data for an existing tenant slug.
`;

export async function resolveSeedTenant(
  db: NodePgDatabase,
  options: SeedOptions,
): Promise<SeedTenant> {
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
    })
    .from(organizations)
    .where(
      options.tenantSlug
        ? eq(organizations.slug, options.tenantSlug)
        : eq(organizations.id, options.tenantId ?? DEFAULT_TENANT_ID),
    )
    .limit(1);

  const tenant = rows[0];
  if (!tenant) {
    const target = options.tenantSlug
      ? `slug "${options.tenantSlug}"`
      : `id "${options.tenantId ?? DEFAULT_TENANT_ID}"`;
    throw new Error(
      `Seed tenant not found for ${target}. Create the tenant first, then rerun the seed.`,
    );
  }

  return tenant;
}

export function withTenant<T extends object>(
  tenant: SeedTenant,
  values: T,
): T & { tenant_id: string } {
  return {
    ...values,
    tenant_id: tenant.id,
  };
}

export async function clearDatabase(db: NodePgDatabase, tenantId: string) {
  console.log(`Clearing existing data for tenant ${tenantId}...`);

  await db.delete(auditLogs).where(eq(auditLogs.tenant_id, tenantId));
  await db.delete(stockMovements).where(eq(stockMovements.tenant_id, tenantId));
  await db.execute(sql`
    DELETE FROM order_items
    WHERE order_id IN (
      SELECT id FROM orders WHERE tenant_id = ${tenantId}
    )
  `);
  await db.delete(orders).where(eq(orders.tenant_id, tenantId));
  await db.delete(inventory).where(eq(inventory.tenant_id, tenantId));
  await db
    .delete(supplierProducts)
    .where(eq(supplierProducts.tenant_id, tenantId));
  await db.delete(areas).where(eq(areas.tenant_id, tenantId));
  await db.delete(locations).where(eq(locations.tenant_id, tenantId));
  await db.delete(clients).where(eq(clients.tenant_id, tenantId));
  await db.delete(products).where(eq(products.tenant_id, tenantId));
  await db.delete(suppliers).where(eq(suppliers.tenant_id, tenantId));
  await db.delete(categories).where(eq(categories.tenant_id, tenantId));

  console.log('Database cleared\n');
}
