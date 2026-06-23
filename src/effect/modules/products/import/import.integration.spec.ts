import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { Permission, Resource } from '@stocket/types/auth';
import { EntitlementSource, PlanKey } from '@stocket/types/features';
import {
  areas,
  inventory,
  locations,
  members,
  organizations,
  products,
  rolePermissions,
  roles,
  tenantEntitlementProfiles,
  tenantDomains,
  userRoles,
} from '../../../platform/db/schema';
import type { DrizzleDb } from '../../../platform/db/drizzle';
import { hostnameForTenantSlug } from '../../../platform/tenancy/host';
import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_NAME,
  DEFAULT_TENANT_SLUG,
} from '../../../platform/tenancy/tenant-constants';
import { makeTestHttpAppHandler } from '../../../testing/app-harness';
import {
  getTestDb,
  seedArea,
  seedBetterAuthUser,
  seedCategory,
  seedInventory,
  seedLocation,
  seedProduct,
  TEST_USER_ID,
  withTestDb,
} from '../../../testing/test-harness';

let db: DrizzleDb;

const TEST_TENANT_HOST = hostnameForTenantSlug(DEFAULT_TENANT_SLUG);
const TEST_TENANT_ORIGIN = `http://${TEST_TENANT_HOST}`;
const AREA_SCOPED_IMPORT_ERROR =
  'Cannot import location-level inventory while area-scoped inventory exists for this product and location.';

const makeSession = (userId = TEST_USER_ID) => ({
  user: {
    id: userId,
    name: 'Product Import Test User',
    email: `${userId}@example.com`,
    image: null,
    emailVerified: true,
    createdAt: new Date('2026-06-01T08:00:00.000Z'),
    updatedAt: new Date('2026-06-01T08:00:00.000Z'),
    role: 'user' as const,
  },
  session: {
    id: `session-${userId}`,
    userId,
    token: `token-${userId}`,
    createdAt: new Date('2026-06-01T08:00:00.000Z'),
    updatedAt: new Date('2026-06-01T08:00:00.000Z'),
    expiresAt: new Date('2026-07-01T08:00:00.000Z'),
    activeOrganizationId: null,
  },
});

const tenantRequest = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('host', TEST_TENANT_HOST);

  return new Request(`${TEST_TENANT_ORIGIN}${path}`, {
    ...init,
    headers,
  });
};

async function seedDefaultTenantDomain() {
  await db
    .insert(organizations)
    .values({
      id: DEFAULT_TENANT_ID,
      name: DEFAULT_TENANT_NAME,
      slug: DEFAULT_TENANT_SLUG,
    })
    .onConflictDoNothing();

  await db
    .insert(tenantDomains)
    .values({
      tenant_id: DEFAULT_TENANT_ID,
      hostname: TEST_TENANT_HOST,
      kind: 'subdomain',
      is_primary: true,
      verified_at: new Date(),
    })
    .onConflictDoNothing();

  await db
    .insert(tenantEntitlementProfiles)
    .values({
      tenant_id: DEFAULT_TENANT_ID,
      plan_key: PlanKey.GROWTH,
      source: EntitlementSource.MANUAL,
      updated_by: TEST_USER_ID,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: tenantEntitlementProfiles.tenant_id,
      set: {
        plan_key: PlanKey.GROWTH,
        source: EntitlementSource.MANUAL,
        updated_by: TEST_USER_ID,
        updated_at: new Date(),
      },
    });
}

async function seedImportWriteRole(userId: string) {
  await seedBetterAuthUser(db, { id: userId });
  await seedDefaultTenantDomain();
  await db
    .insert(members)
    .values({
      id: randomUUID(),
      organization_id: DEFAULT_TENANT_ID,
      user_id: userId,
      role: 'member',
    })
    .onConflictDoNothing();

  const [role] = await db
    .insert(roles)
    .values({
      tenant_id: DEFAULT_TENANT_ID,
      name: `Product Import ${randomUUID()}`,
      is_system: false,
    })
    .returning();

  if (!role) throw new Error('Failed to seed import role');

  await db.insert(rolePermissions).values([
    {
      role_id: role.id,
      resource: Resource.PRODUCTS,
      permission: Permission.WRITE,
    },
    {
      role_id: role.id,
      resource: Resource.LOCATIONS,
      permission: Permission.WRITE,
    },
    {
      role_id: role.id,
      resource: Resource.INVENTORY,
      permission: Permission.WRITE,
    },
  ]);

  await db.insert(userRoles).values({
    tenant_id: DEFAULT_TENANT_ID,
    user_id: userId,
    role_id: role.id,
  });
}

function makeCsvUpload(
  csv: string,
  filename: string,
  fields: Record<string, string> = {},
) {
  const formData = new FormData();
  formData.append('file', new File([csv], filename, { type: 'text/csv' }));
  Object.entries(fields).forEach(([key, value]) => {
    formData.append(key, value);
  });
  return formData;
}

async function postImport(
  csv: string,
  filename = 'products.csv',
  fields: Record<string, string> = {},
) {
  await seedImportWriteRole(TEST_USER_ID);
  const { handler, dispose } = makeTestHttpAppHandler({
    session: makeSession(TEST_USER_ID),
  });

  try {
    const response = await handler(
      tenantRequest('/api/v1/products/import', {
        method: 'POST',
        body: makeCsvUpload(csv, filename, fields),
      }),
    );
    const body = await response.json();
    return { status: response.status, body };
  } finally {
    await dispose();
  }
}

async function postPreview(
  csv: string,
  filename = 'products.csv',
  fields: Record<string, string> = {},
) {
  await seedImportWriteRole(TEST_USER_ID);
  const { handler, dispose } = makeTestHttpAppHandler({
    session: makeSession(TEST_USER_ID),
  });

  try {
    const response = await handler(
      tenantRequest('/api/v1/products/import/preview', {
        method: 'POST',
        body: makeCsvUpload(csv, filename, fields),
      }),
    );
    const body = await response.json();
    return { status: response.status, body };
  } finally {
    await dispose();
  }
}

async function postCommit(
  csv: string,
  mapping: unknown,
  filename = 'products.csv',
  fields: Record<string, string> = {},
) {
  await seedImportWriteRole(TEST_USER_ID);
  const { handler, dispose } = makeTestHttpAppHandler({
    session: makeSession(TEST_USER_ID),
  });

  try {
    const response = await handler(
      tenantRequest('/api/v1/products/import/commit', {
        method: 'POST',
        body: makeCsvUpload(csv, filename, {
          mapping: JSON.stringify(mapping),
          ...fields,
        }),
      }),
    );
    const body = await response.json();
    return { status: response.status, body };
  } finally {
    await dispose();
  }
}

const findProductBySku = async (sku: string, tenantId = DEFAULT_TENANT_ID) => {
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.tenant_id, tenantId), eq(products.sku, sku)))
    .limit(1);
  return rows[0] ?? null;
};

const findRootInventoryRows = (productId: string, locationId: string) =>
  db
    .select()
    .from(inventory)
    .where(
      and(
        eq(inventory.tenant_id, DEFAULT_TENANT_ID),
        eq(inventory.product_id, productId),
        eq(inventory.location_id, locationId),
        isNull(inventory.area_id),
      ),
    );

async function seedAreaScopedInventoryFixture(options: {
  readonly areaName: string;
  readonly categoryName: string;
  readonly locationName: string;
  readonly productName: string;
  readonly productSku: string;
  readonly rootQuantity?: number;
}) {
  const category = await seedCategory(db, {
    tenant_id: DEFAULT_TENANT_ID,
    name: options.categoryName,
  });
  const product = await seedProduct(db, {
    tenant_id: DEFAULT_TENANT_ID,
    category_id: category.id,
    sku: options.productSku,
    name: options.productName,
    reorder_point: 10,
  });
  const location = await seedLocation(db, {
    tenant_id: DEFAULT_TENANT_ID,
    name: options.locationName,
  });
  const area = await seedArea(db, {
    tenant_id: DEFAULT_TENANT_ID,
    location_id: location.id,
    name: options.areaName,
  });

  if (options.rootQuantity !== undefined) {
    await seedInventory(db, {
      tenant_id: DEFAULT_TENANT_ID,
      product_id: product.id,
      location_id: location.id,
      area_id: null,
      quantity: options.rootQuantity,
    });
  }

  await seedInventory(db, {
    tenant_id: DEFAULT_TENANT_ID,
    product_id: product.id,
    location_id: location.id,
    area_id: area.id,
    quantity: 5,
  });

  return { area, category, location, product };
}

withTestDb();
beforeAll(() => {
  db = getTestDb();
});

describe('POST /api/v1/products/import integration', () => {
  it('imports normalized CSV into products, categories, locations, and inventory', async () => {
    const response =
      await postImport(`sku,name,category_path,reorder_point,quantity,location,unit,standard_price,barcode,description,notes,is_active,is_perishable,expiry_date
IMP-001,Imported Gin,Beverages / Spirits,4,9,Main Warehouse,bottle,12.50,123456,Juniper gin,Top shelf,true,false,
`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      categoriesCreated: 2,
      locationsCreated: 1,
      productsCreated: 1,
      inventoryRecordsCreated: 1,
      rowsSkipped: 0,
      errors: [],
    });

    const product = await findProductBySku('IMP-001');
    expect(product).toMatchObject({
      tenant_id: DEFAULT_TENANT_ID,
      name: 'Imported Gin',
      unit: 'bottle',
      barcode: '123456',
      standard_price: 12.5,
      reorder_point: 4,
      is_active: true,
      is_perishable: false,
    });

    const [location] = await db
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.tenant_id, DEFAULT_TENANT_ID),
          eq(locations.name, 'Main Warehouse'),
        ),
      )
      .limit(1);
    expect(location).toBeTruthy();

    const [stock] = await db
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.tenant_id, DEFAULT_TENANT_ID),
          eq(inventory.product_id, product!.id),
          eq(inventory.location_id, location!.id),
        ),
      )
      .limit(1);
    expect(stock).toMatchObject({ quantity: 9 });
  });

  it('imports Sortly item CSV through the same API path', async () => {
    const response = await postImport(
      `Entry Type,Entry Name,SID,Primary Folder,Subfolder-level1,Quantity,Location,Unit,Min Level,Price,Barcode/QR1-Data,Barcode/QR2-Data,Notes,Expiry Date
Item,Imported Tonic,SORT-001,Drinks,Mixers,12,Bar,can,2,1.50,,QR2,Sortly notes,28/08/2025 01:26PM
`,
      'sortly.csv',
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      categoriesCreated: 2,
      locationsCreated: 1,
      productsCreated: 1,
      inventoryRecordsCreated: 1,
      rowsSkipped: 0,
      errors: [],
    });

    const product = await findProductBySku('SORT-001');
    expect(product).toMatchObject({
      name: 'Imported Tonic',
      description: null,
      unit: 'can',
      barcode: 'QR2',
      standard_price: 1.5,
      reorder_point: 2,
      is_perishable: true,
      notes: 'Sortly notes',
    });

    const [stock] = await db
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.tenant_id, DEFAULT_TENANT_ID),
          eq(inventory.product_id, product!.id),
        ),
      )
      .limit(1);
    expect(stock).toMatchObject({ quantity: 12 });
    expect(stock!.expiry_date).toBeInstanceOf(Date);
  });

  it('previews Sortly CSV without writing products, locations, or inventory', async () => {
    const response = await postPreview(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location,Photo1
Folder,Amenities,,,,,
Item,Imported Soap,SORT-PREVIEW-1,Amenities,6,Bay J - Shelf 4,https://example.com/photo.jpg
`,
      'sortly-preview.csv',
      {
        import_type: 'sortly-items',
        known_locations: JSON.stringify(['Bay J']),
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      detectedFormat: 'sortly-items',
      stats: {
        totalRows: 2,
        importableRows: 1,
        itemRows: 1,
        folderRows: 1,
        itemsWithPhotos: 1,
      },
      suggestedMapping: {
        locationMappings: [
          {
            source: 'Bay J - Shelf 4',
            locationName: 'Bay J',
            areaPath: 'Shelf 4',
          },
        ],
      },
      issues: [],
    });

    await expect(findProductBySku('SORT-PREVIEW-1')).resolves.toBeNull();
    const writtenLocations = await db
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.tenant_id, DEFAULT_TENANT_ID),
          eq(locations.name, 'Bay J'),
        ),
      );
    expect(writtenLocations).toHaveLength(0);
  });

  it('commits approved mappings into nested areas and area-scoped inventory', async () => {
    const mapping = {
      categoryMappings: [{ source: 'Amenities', target: 'Amenities' }],
      locationMappings: [
        {
          source: 'Bay J - Shelf 4',
          locationName: 'Bay J',
          areaPath: 'Shelf 4',
        },
      ],
    };
    const response = await postCommit(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location
Item,Imported Soap,SORT-COMMIT-1,Amenities,6,Bay J - Shelf 4
`,
      mapping,
      'sortly-commit.csv',
      { import_type: 'sortly-items' },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      categoriesCreated: 1,
      locationsCreated: 1,
      areasCreated: 1,
      productsCreated: 1,
      inventoryRecordsCreated: 1,
      rowsSkipped: 0,
      errors: [],
    });

    const product = await findProductBySku('SORT-COMMIT-1');
    expect(product).toMatchObject({ name: 'Imported Soap' });

    const [location] = await db
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.tenant_id, DEFAULT_TENANT_ID),
          eq(locations.name, 'Bay J'),
        ),
      )
      .limit(1);
    expect(location).toBeTruthy();

    const [area] = await db
      .select()
      .from(areas)
      .where(
        and(
          eq(areas.tenant_id, DEFAULT_TENANT_ID),
          eq(areas.location_id, location!.id),
          eq(areas.name, 'Shelf 4'),
        ),
      )
      .limit(1);
    expect(area).toBeTruthy();

    const [stock] = await db
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.tenant_id, DEFAULT_TENANT_ID),
          eq(inventory.product_id, product!.id),
          eq(inventory.location_id, location!.id),
          eq(inventory.area_id, area!.id),
        ),
      )
      .limit(1);
    expect(stock).toMatchObject({ quantity: 6 });
  });

  it('does not update products from another tenant with the same SKU', async () => {
    const otherTenantId = randomUUID();
    const otherCategory = await seedCategory(db, {
      tenant_id: otherTenantId,
      name: 'Other Tenant Category',
    });
    const otherProduct = await seedProduct(db, {
      tenant_id: otherTenantId,
      category_id: otherCategory.id,
      sku: 'SHARED-SKU',
      name: 'Other Tenant Product',
    });

    const response = await postImport(`sku,name,category_path,quantity,location
SHARED-SKU,Default Tenant Product,Default Category,3,Default Location
`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      productsCreated: 1,
      productsUpdated: 0,
      rowsSkipped: 0,
    });

    const defaultProduct = await findProductBySku('SHARED-SKU');
    expect(defaultProduct).toMatchObject({
      tenant_id: DEFAULT_TENANT_ID,
      name: 'Default Tenant Product',
    });

    const [unchangedOtherProduct] = await db
      .select()
      .from(products)
      .where(eq(products.id, otherProduct.id))
      .limit(1);
    expect(unchangedOtherProduct).toMatchObject({
      tenant_id: otherTenantId,
      sku: 'SHARED-SKU',
      name: 'Other Tenant Product',
    });
  });

  it('reports an error instead of creating root inventory when area-scoped inventory exists', async () => {
    const { location, product } = await seedAreaScopedInventoryFixture({
      areaName: 'Shelf A',
      categoryName: 'Area Category',
      locationName: 'Area Location',
      productName: 'Area Product',
      productSku: 'AREA-SKU',
    });

    const response =
      await postImport(`sku,name,category_path,reorder_point,quantity,location
AREA-SKU,Area Product,Area Category,10,8,Area Location
`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      productsCreated: 0,
      productsUpdated: 0,
      inventoryRecordsCreated: 0,
      rowsSkipped: 1,
    });
    expect(response.body.errors).toHaveLength(1);
    expect(response.body.errors[0]).toMatchObject({
      row: 2,
      error: AREA_SCOPED_IMPORT_ERROR,
    });

    const rootRows = await findRootInventoryRows(product.id, location.id);
    expect(rootRows).toHaveLength(0);
  });

  it('reports an error instead of updating root inventory when area-scoped inventory also exists', async () => {
    const { location, product } = await seedAreaScopedInventoryFixture({
      areaName: 'Shelf B',
      categoryName: 'Mixed Area Category',
      locationName: 'Mixed Area Location',
      productName: 'Mixed Area Product',
      productSku: 'MIXED-AREA-SKU',
      rootQuantity: 4,
    });

    const response =
      await postImport(`sku,name,category_path,reorder_point,quantity,location
MIXED-AREA-SKU,Mixed Area Product,Mixed Area Category,10,8,Mixed Area Location
`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      productsCreated: 0,
      productsUpdated: 0,
      inventoryRecordsUpdated: 0,
      rowsSkipped: 1,
    });
    expect(response.body.errors).toHaveLength(1);
    expect(response.body.errors[0]).toMatchObject({
      row: 2,
      error: AREA_SCOPED_IMPORT_ERROR,
    });

    const rootRows = await findRootInventoryRows(product.id, location.id);
    expect(rootRows).toHaveLength(1);
    expect(rootRows[0]).toMatchObject({ quantity: 4 });
  });
});
