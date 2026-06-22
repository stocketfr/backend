import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { makeTestLayer } from '../../../testing/utils';
import { ProductImportRepository } from './repository';
import {
  detectProductImportFormat,
  makeProductImportPreview,
  normalizeProductImportRecords,
  parseDate,
  parseProductImportMappingJson,
  parseProductImportNumber,
  parseCsvContent,
  suggestImportMapping,
} from './utils';
import { ProductImportService } from './service';
import { PhotosService } from '../../photos/service';

const TEST_USER_ID = '00000000-0000-4000-a000-000000000001';

const makeRow = <T extends Record<string, unknown>>(overrides: T) =>
  ({
    tenant_id: 'tenant-1',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as T & {
    tenant_id: string;
    created_at: Date;
    updated_at: Date;
  };

function makeInMemoryRepository() {
  let nextId = 1;
  const areas: any[] = [];
  const categories: any[] = [];
  const locations: any[] = [];
  const productsBySku = new Map<string, any>();
  const inventoryByKey = new Map<string, any>();

  const id = (prefix: string) => `${prefix}-${nextId++}`;
  const inventoryKey = (
    productId: string,
    locationId: string,
    areaId: string | null = null,
  ) => `${productId}:${locationId}:${areaId ?? 'root'}`;

  const repo = {
    findCategoryByNameAndParent: vi.fn(
      (name: string, parentId: string | null) =>
        Effect.sync(
          () =>
            categories.find(
              (category) =>
                category.name === name && category.parent_id === parentId,
            ) ?? null,
        ),
    ),
    createCategory: vi.fn((data: any) =>
      Effect.sync(() => {
        const row = makeRow({ id: id('cat'), ...data } as any);
        categories.push(row);
        return row;
      }),
    ),
    findLocationByName: vi.fn((name: string) =>
      Effect.sync(
        () => locations.find((location) => location.name === name) ?? null,
      ),
    ),
    createLocation: vi.fn((data: any) =>
      Effect.sync(() => {
        const row = makeRow({ id: id('loc'), ...data } as any);
        locations.push(row);
        return row;
      }),
    ),
    findAreaByNameLocationAndParent: vi.fn(
      (name: string, locationId: string, parentId: string | null) =>
        Effect.sync(
          () =>
            areas.find(
              (area) =>
                area.name === name &&
                area.location_id === locationId &&
                area.parent_id === parentId,
            ) ?? null,
        ),
    ),
    createArea: vi.fn((data: any) =>
      Effect.sync(() => {
        const row = makeRow({ id: id('area'), ...data } as any);
        areas.push(row);
        return row;
      }),
    ),
    findProductBySku: vi.fn((sku: string) =>
      Effect.sync(() => productsBySku.get(sku) ?? null),
    ),
    createProduct: vi.fn((data: any) =>
      Effect.sync(() => {
        const row = makeRow({
          id: id('prod'),
          deleted_at: null,
          ...data,
        } as any);
        productsBySku.set(row.sku, row);
        return row;
      }),
    ),
    updateProduct: vi.fn((productId: string, data: any) =>
      Effect.sync(() => {
        for (const [sku, product] of productsBySku.entries()) {
          if (product.id === productId) {
            const row = { ...product, ...data };
            productsBySku.set(sku, row);
            return row;
          }
        }
        return null;
      }),
    ),
    findInventoryByProductLocationArea: vi.fn(
      (productId: string, locationId: string, areaId: string | null) =>
        Effect.sync(
          () =>
            inventoryByKey.get(inventoryKey(productId, locationId, areaId)) ??
            null,
        ),
    ),
    findRootInventoryByProductAndLocation: vi.fn(
      (productId: string, locationId: string) =>
        Effect.sync(
          () => inventoryByKey.get(inventoryKey(productId, locationId)) ?? null,
        ),
    ),
    hasAreaScopedInventoryForProductAndLocation: vi.fn(() =>
      Effect.succeed(false),
    ),
    createInventory: vi.fn((data: any) =>
      Effect.sync(() => {
        const row = makeRow({ id: id('inv'), ...data } as any);
        inventoryByKey.set(
          inventoryKey(row.product_id, row.location_id, row.area_id ?? null),
          row,
        );
        return row;
      }),
    ),
    updateInventory: vi.fn((inventoryId: string, data: any) =>
      Effect.sync(() => {
        for (const [key, inventory] of inventoryByKey.entries()) {
          if (inventory.id === inventoryId) {
            const row = { ...inventory, ...data };
            inventoryByKey.set(key, row);
            return row;
          }
        }
        return null;
      }),
    ),
  };

  return {
    repo: repo as Partial<ProductImportRepository>,
    areas,
    categories,
    locations,
    productsBySku,
    inventoryByKey,
    inventoryKey,
  };
}

type InMemoryImportState = ReturnType<typeof makeInMemoryRepository>;

const makeImportServiceLayer = (repo: Partial<ProductImportRepository>) =>
  ProductImportService.DefaultWithoutDependencies.pipe(
    Layer.provide(
      Layer.mergeAll(
        makeTestLayer(ProductImportRepository)(repo),
        makeTestLayer(PhotosService)({
          uploadPhoto: vi.fn(() =>
            Effect.succeed({
              id: 'photo-1',
              product_id: 'prod-1',
              filename: 'photo.jpg',
              mimetype: 'image/jpeg',
              size: 100,
              storage_path: 'products/prod-1/photos/photo.jpg',
              display_order: 0,
              uploaded_by: null,
              created_at: new Date('2026-01-01T00:00:00.000Z'),
            }),
          ),
          findByProductId: vi.fn(() => Effect.succeed([])),
          getFile: vi.fn(() =>
            Effect.succeed({
              bytes: new Uint8Array(),
              mimetype: 'image/jpeg',
              filename: 'photo.jpg',
            }),
          ),
          deletePhoto: vi.fn(() => Effect.void),
        }),
      ),
    ),
  );

const seedExistingProductWithRootInventory = (
  state: InMemoryImportState,
  options: {
    readonly hasAreaScopedInventory?: boolean;
    readonly rootExpiryDate?: Date | null;
  } = {},
) => {
  state.categories.push(
    makeRow({
      id: 'cat-1',
      name: 'Food',
      parent_id: null,
      description: null,
    } as any),
  );
  state.locations.push(
    makeRow({
      id: 'loc-1',
      name: 'Warehouse',
      type: 'WAREHOUSE',
      address: '',
      contact_person: '',
      phone: '',
      is_active: true,
    } as any),
  );
  state.productsBySku.set(
    'SKU-1',
    makeRow({
      id: 'prod-1',
      sku: 'SKU-1',
      name: 'Same Product',
      category_id: 'cat-1',
      description: null,
      unit: null,
      barcode: null,
      standard_price: null,
      reorder_point: 0,
      is_active: true,
      is_perishable: false,
      notes: null,
      deleted_at: null,
    } as any),
  );
  state.inventoryByKey.set(
    state.inventoryKey('prod-1', 'loc-1'),
    makeRow({
      id: 'inv-1',
      product_id: 'prod-1',
      location_id: 'loc-1',
      area_id: null,
      quantity: 4,
      batch_number: '',
      expiry_date: options.rootExpiryDate ?? null,
      cost_per_unit: null,
      received_date: null,
    } as any),
  );

  if (options.hasAreaScopedInventory) {
    (
      state.repo.hasAreaScopedInventoryForProductAndLocation as any
    ).mockReturnValue(Effect.succeed(true));
  }
};

const runImport = (
  content: string,
  importType: 'auto' | 'normalized-products' | 'sortly-items' = 'auto',
) => {
  const { repo } = makeInMemoryRepository();
  const layer = makeImportServiceLayer(repo);
  return Effect.runPromise(
    Effect.flatMap(ProductImportService, (service) =>
      service.importFromCsvContent({
        content,
        importType,
        userId: TEST_USER_ID,
      }),
    ).pipe(Effect.provide(layer)),
  );
};

const runImportWithState = async (
  content: string,
  importType: 'auto' | 'normalized-products' | 'sortly-items' = 'auto',
  setup?: (state: ReturnType<typeof makeInMemoryRepository>) => void,
  options: Partial<
    Parameters<ProductImportService['importFromCsvContent']>[0]
  > = {},
) => {
  const state = makeInMemoryRepository();
  setup?.(state);
  const layer = makeImportServiceLayer(state.repo);
  const result = await Effect.runPromise(
    Effect.flatMap(ProductImportService, (service) =>
      service.importFromCsvContent({
        content,
        importType,
        userId: TEST_USER_ID,
        ...options,
      }),
    ).pipe(Effect.provide(layer)),
  );
  return { result, state };
};

const failImport = (
  content: string,
  importType: 'auto' | 'normalized-products' | 'sortly-items' = 'auto',
) => {
  const { repo } = makeInMemoryRepository();
  const layer = makeImportServiceLayer(repo);
  return Effect.runPromise(
    Effect.flip(
      Effect.flatMap(ProductImportService, (service) =>
        service.importFromCsvContent({
          content,
          importType,
          userId: TEST_USER_ID,
        }),
      ).pipe(Effect.provide(layer)),
    ),
  );
};

describe('ProductImportService', () => {
  it('detects normalized product CSV headers', () => {
    expect(
      detectProductImportFormat([
        'sku',
        'name',
        'category_path',
        'quantity',
        'location',
      ]),
    ).toBe('normalized-products');
  });

  it('detects and normalizes Sortly item CSV rows', () => {
    const format = detectProductImportFormat([
      'Entry Type',
      'Entry Name',
      'SID',
      'Primary Folder',
      'Subfolder-level1',
      'Quantity',
      'Unit',
      'Barcode/QR1-Data',
      'Barcode/QR2-Data',
      'Expiry Date',
    ]);
    expect(format).toBe('sortly-items');

    const [row] = normalizeProductImportRecords(
      [
        {
          'Entry Type': 'Item',
          'Entry Name': 'Cognac',
          SID: 'SID-1',
          'Primary Folder': 'Bar',
          'Subfolder-level1': 'Spirits',
          Quantity: '12',
          Unit: 'bottle',
          'Barcode/QR1-Data': '',
          'Barcode/QR2-Data': 'QR2',
          'Expiry Date': '28/08/2025 01:26PM',
        },
      ],
      'sortly-items',
    );

    expect(row).toMatchObject({
      sku: 'SID-1',
      name: 'Cognac',
      category_path: 'Bar / Spirits',
      quantity: '12',
      unit: 'bottle',
      barcode: 'QR2',
      is_perishable: 'true',
    });
    const expiry = parseDate(row!.expiry_date);
    expect(expiry?.getFullYear()).toBe(2025);
    expect(expiry?.getMonth()).toBe(7);
    expect(expiry?.getDate()).toBe(28);
    expect(expiry?.getHours()).toBe(13);
    expect(expiry?.getMinutes()).toBe(26);
  });

  it('filters Sortly folder rows instead of reporting them as import errors', () => {
    const rows = normalizeProductImportRecords(
      [
        {
          'Entry Type': 'Folder',
          'Entry Name': 'Bar',
          SID: 'FOLDER-1',
          'Primary Folder': 'Root',
        },
        {
          'Entry Type': 'Item',
          'Entry Name': 'Cognac',
          SID: 'SID-1',
          'Primary Folder': 'Bar',
        },
      ],
      'sortly-items',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourceRow: 3, sku: 'SID-1' });
  });

  it('parses slash dates as day/month/year with spaced meridiem', () => {
    const expiry = parseDate('1/2/2025 1:30 PM');

    expect(expiry?.getFullYear()).toBe(2025);
    expect(expiry?.getMonth()).toBe(1);
    expect(expiry?.getDate()).toBe(1);
    expect(expiry?.getHours()).toBe(13);
    expect(expiry?.getMinutes()).toBe(30);
  });

  it('rejects invalid slash dates', () => {
    expect(parseDate('31/02/2025')).toBeNull();
  });

  it('parses localized thousands and decimal separators', () => {
    expect(parseProductImportNumber('1,234')).toBe(1234);
    expect(parseProductImportNumber('1 234,56')).toBe(1234.56);
    expect(parseProductImportNumber('1.234,56')).toBe(1234.56);
    expect(parseProductImportNumber('1,234.56')).toBe(1234.56);
  });

  it('builds a preview without writing rows', () => {
    const parsed =
      parseCsvContent(`Entry Type,Entry Name,SID,Primary Folder,Quantity,Location,Photo1,Barcode/QR1-Data
Folder,Amenities,,,,,,
Item,Shampoo,SORT-1,Amenities,8,Bay J - Shelf 4,https://example.com/photo.jpg,123
Item,Comb,SORT-2,,3,,,
`);
    const format = detectProductImportFormat(parsed.headers, 'sortly-items');
    expect(format).toBe('sortly-items');

    const preview = makeProductImportPreview(parsed, format!, {
      knownLocations: ['Bay J'],
      useLlm: true,
    });

    expect(preview.stats).toMatchObject({
      totalRows: 3,
      importableRows: 2,
      itemRows: 2,
      folderRows: 1,
      rowsMissingLocation: 1,
      rowsMissingCategory: 1,
      itemsWithPhotos: 1,
      itemsWithBarcodes: 1,
    });
    expect(preview.locations).toEqual([{ value: 'Bay J - Shelf 4', count: 1 }]);
    expect(preview.suggestedMapping.locationMappings).toEqual([
      {
        source: 'Bay J - Shelf 4',
        locationName: 'Bay J',
        areaPath: 'Shelf 4',
      },
    ]);
    expect(preview.warnings).toEqual([
      {
        warning:
          'AI mapping suggestions are not configured in this environment; deterministic suggestions were used.',
      },
    ]);
  });

  it('suggests location and area mappings from Sortly shelf strings', () => {
    const [row] = normalizeProductImportRecords(
      [
        {
          'Entry Type': 'Item',
          'Entry Name': 'Soap',
          SID: 'SORT-1',
          'Primary Folder': 'Amenities',
          Location: 'Store Room - Box 6',
        },
      ],
      'sortly-items',
    );

    expect(suggestImportMapping([row!]).locationMappings).toEqual([
      {
        source: 'Store Room - Box 6',
        locationName: 'Store Room',
        areaPath: 'Box 6',
      },
    ]);
  });

  it('parses valid import mapping JSON and rejects invalid shapes', () => {
    expect(
      parseProductImportMappingJson(
        JSON.stringify({
          categoryMappings: [{ source: 'Raw', target: 'Final / Path' }],
          locationMappings: [
            {
              source: 'Bay J - Shelf 4',
              locationName: 'Bay J',
              areaPath: 'Shelf 4',
            },
          ],
        }),
      ),
    ).toEqual({
      categoryMappings: [{ source: 'Raw', target: 'Final / Path' }],
      locationMappings: [
        {
          source: 'Bay J - Shelf 4',
          locationName: 'Bay J',
          areaPath: 'Shelf 4',
        },
      ],
    });
    expect(parseProductImportMappingJson('{not json')).toBeNull();
    expect(parseProductImportMappingJson('{"categoryMappings":[]}')).toBeNull();
  });

  it('rejects unsupported CSV headers', async () => {
    const error = await failImport('foo,bar\n1,2\n');
    expect(error).toMatchObject({ _tag: 'ProductImportUnsupportedFormat' });
  });

  it('reports missing sku or name as row errors', async () => {
    const result = await runImport(`sku,name,category_path
,Missing SKU,Food
SKU-2,,Food
`);

    expect(result.rowsSkipped).toBe(2);
    expect(result.errors).toEqual([
      { row: 2, error: 'Cannot import product without sku and name' },
      { row: 3, error: 'Cannot import product without sku and name' },
    ]);
  });

  it('reports conflicting duplicate SKUs', async () => {
    const result = await runImport(`sku,name,category_path,location
SKU-1,First Name,Food,Warehouse
SKU-1,Second Name,Food,Bar
`);

    expect(result.rowsSkipped).toBe(2);
    expect(result.productsCreated).toBe(0);
    expect(result.errors).toEqual([
      {
        row: 2,
        error: 'Conflicting duplicate SKU "SKU-1" has different product fields',
      },
      {
        row: 3,
        error: 'Conflicting duplicate SKU "SKU-1" has different product fields',
      },
    ]);
  });

  it('allows consistent duplicate SKUs for multiple locations', async () => {
    const { result, state } =
      await runImportWithState(`sku,name,category_path,location,quantity,reorder_point
SKU-1,Same Product,Food,Warehouse,5,1
SKU-1,Same Product,Food,Bar,7,1
`);

    expect(result.rowsSkipped).toBe(0);
    expect(result.productsCreated).toBe(1);
    expect(result.productsUpdated).toBe(0);
    expect(result.inventoryRecordsCreated).toBe(2);
    expect(result.errors).toEqual([]);
    expect((state.repo.updateProduct as any).mock.calls).toHaveLength(0);
  });

  it('commits approved location mappings into nested areas and area inventory', async () => {
    const { result, state } = await runImportWithState(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location
Item,Guest Soap,SORT-1,Amenities,8,Bay J - Shelf 4
`,
      'sortly-items',
      undefined,
      {
        mapping: {
          categoryMappings: [
            { source: 'Amenities', target: 'Amenities / Bath' },
          ],
          locationMappings: [
            {
              source: 'Bay J - Shelf 4',
              locationName: 'Bay J',
              areaPath: 'Shelf 4',
            },
          ],
        },
      },
    );

    expect(result).toMatchObject({
      categoriesCreated: 2,
      locationsCreated: 1,
      areasCreated: 1,
      productsCreated: 1,
      inventoryRecordsCreated: 1,
      rowsSkipped: 0,
      errors: [],
    });
    const location = state.locations[0]!;
    const area = state.areas[0]!;
    expect(location).toMatchObject({ name: 'Bay J' });
    expect(area).toMatchObject({
      name: 'Shelf 4',
      location_id: location.id,
      parent_id: null,
    });
    const product = state.productsBySku.get('SORT-1');
    expect(product).toMatchObject({ name: 'Guest Soap' });
    expect(
      state.inventoryByKey.get(
        state.inventoryKey(product.id, location.id, area.id),
      ),
    ).toMatchObject({
      quantity: 8,
      area_id: area.id,
    });
    expect(
      state.inventoryByKey.get(state.inventoryKey(product.id, location.id)),
    ).toBeUndefined();
  });

  it('reports missing mappings during commit without guessing', async () => {
    const { result } = await runImportWithState(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location
Item,Guest Soap,SORT-1,Amenities,8,Bay J - Shelf 4
`,
      'sortly-items',
      undefined,
      {
        mapping: {
          categoryMappings: [{ source: 'Amenities', target: 'Amenities' }],
          locationMappings: [],
        },
      },
    );

    expect(result.rowsSkipped).toBe(1);
    expect(result.productsCreated).toBe(0);
    expect(result.errors).toEqual([
      {
        row: 2,
        error: 'Missing location mapping for "Bay J - Shelf 4"',
      },
    ]);
  });

  it('reports normalized duplicate SKUs with conflicting reorder points', async () => {
    const result =
      await runImport(`sku,name,category_path,location,quantity,reorder_point
SKU-1,Same Product,Food,Warehouse,5,1
SKU-1,Same Product,Food,Bar,7,2
`);

    expect(result.rowsSkipped).toBe(2);
    expect(result.productsCreated).toBe(0);
    expect(result.inventoryRecordsCreated).toBe(0);
    expect(result.errors).toEqual([
      {
        row: 2,
        error: 'Conflicting duplicate SKU "SKU-1" has different product fields',
      },
      {
        row: 3,
        error: 'Conflicting duplicate SKU "SKU-1" has different product fields',
      },
    ]);
  });

  it('does not treat Sortly location-specific min levels as duplicate SKU conflicts', async () => {
    const result = await runImport(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location,Min Level
Item,Same Product,SORT-1,Food,5,Warehouse,2
Item,Same Product,SORT-1,Food,7,Bar,5
`,
      'sortly-items',
    );

    expect(result.rowsSkipped).toBe(0);
    expect(result.productsCreated).toBe(1);
    expect(result.productsUpdated).toBe(0);
    expect(result.inventoryRecordsCreated).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('clears stale inventory expiry dates when an update row has an empty expiry date', async () => {
    const existingExpiry = new Date('2026-01-01T00:00:00.000Z');
    const { result, state } = await runImportWithState(
      `sku,name,category_path,location,quantity
SKU-1,Same Product,Food,Warehouse,8
`,
      'auto',
      (state) =>
        seedExistingProductWithRootInventory(state, {
          rootExpiryDate: existingExpiry,
        }),
    );

    expect(result.inventoryRecordsUpdated).toBe(1);
    expect(
      state.inventoryByKey.get(state.inventoryKey('prod-1', 'loc-1')),
    ).toMatchObject({
      quantity: 8,
      expiry_date: null,
    });
  });

  it('reports malformed expiry dates without importing the row', async () => {
    const { result, state } = await runImportWithState(
      `sku,name,category_path,location,quantity,expiry_date
SKU-1,Whisky,Food,Warehouse,8,31/02/2025
`,
    );

    expect(result.rowsSkipped).toBe(1);
    expect(result.productsCreated).toBe(0);
    expect(result.inventoryRecordsCreated).toBe(0);
    expect(result.errors).toEqual([
      { row: 2, error: 'Invalid expiry_date "31/02/2025"' },
    ]);
    expect(state.categories).toHaveLength(0);
    expect(state.locations).toHaveLength(0);
    expect(state.productsBySku.size).toBe(0);
    expect(state.inventoryByKey.size).toBe(0);
  });

  it('reports an error without partial row writes when area-scoped inventory exists', async () => {
    const { result, state } = await runImportWithState(
      `sku,name,category_path,location,quantity
SKU-1,Changed Product,Drinks,Warehouse,8
`,
      'auto',
      (state) =>
        seedExistingProductWithRootInventory(state, {
          hasAreaScopedInventory: true,
        }),
    );

    expect(result.categoriesCreated).toBe(0);
    expect(result.locationsCreated).toBe(0);
    expect(result.productsUpdated).toBe(0);
    expect(result.inventoryRecordsUpdated).toBe(0);
    expect(result.rowsSkipped).toBe(1);
    expect(result.errors).toEqual([
      {
        row: 2,
        error:
          'Cannot import location-level inventory while area-scoped inventory exists for this product and location.',
      },
    ]);
    expect((state.repo.createCategory as any).mock.calls).toHaveLength(0);
    expect((state.repo.createLocation as any).mock.calls).toHaveLength(0);
    expect((state.repo.updateProduct as any).mock.calls).toHaveLength(0);
    expect(state.productsBySku.get('SKU-1')).toMatchObject({
      name: 'Same Product',
      category_id: 'cat-1',
    });
    expect(
      state.inventoryByKey.get(state.inventoryKey('prod-1', 'loc-1')),
    ).toMatchObject({
      quantity: 4,
    });
  });

  it('leaves Sortly notes out of the description field', () => {
    const [row] = normalizeProductImportRecords(
      [
        {
          'Entry Type': 'Item',
          'Entry Name': 'Cognac',
          SID: 'SID-1',
          'Primary Folder': 'Bar',
          Notes: 'Freeform note',
        },
      ],
      'sortly-items',
    );

    expect(row).toMatchObject({
      description: '',
      notes: 'Freeform note',
    });
  });
});
