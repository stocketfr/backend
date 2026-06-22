import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { makeTestLayer } from '../../../testing/utils';
import { ProductImportRepository } from './repository';
import {
  detectProductImportFormat,
  normalizeProductImportRecords,
  parseDate,
  parseProductImportNumber,
} from './utils';
import { ProductImportService } from './service';

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
  const categories: any[] = [];
  const locations: any[] = [];
  const areas: any[] = [];
  const suppliers: any[] = [];
  const productsBySku = new Map<string, any>();
  const inventoryByKey = new Map<string, any>();

  const id = (prefix: string) => `${prefix}-${nextId++}`;

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
    findAreaByNameParentAndLocation: vi.fn(
      (name: string, parentId: string | null, locationId: string) =>
        Effect.sync(
          () =>
            areas.find(
              (area) =>
                area.name === name &&
                area.parent_id === parentId &&
                area.location_id === locationId,
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
    findSupplierByName: vi.fn((name: string) =>
      Effect.sync(
        () => suppliers.find((supplier) => supplier.name === name) ?? null,
      ),
    ),
    createSupplier: vi.fn((data: any) =>
      Effect.sync(() => {
        const row = makeRow({ id: id('supplier'), ...data } as any);
        suppliers.push(row);
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
    findRootInventoryByProductAndLocation: vi.fn(
      (productId: string, locationId: string) =>
        Effect.sync(
          () => inventoryByKey.get(`${productId}:${locationId}:root`) ?? null,
        ),
    ),
    findInventoryByProductLocationArea: vi.fn(
      (productId: string, locationId: string, areaId: string | null) =>
        Effect.sync(
          () =>
            inventoryByKey.get(
              `${productId}:${locationId}:${areaId ?? 'root'}`,
            ) ?? null,
        ),
    ),
    hasAreaScopedInventoryForProductAndLocation: vi.fn(() =>
      Effect.succeed(false),
    ),
    createInventory: vi.fn((data: any) =>
      Effect.sync(() => {
        const row = makeRow({ id: id('inv'), ...data } as any);
        inventoryByKey.set(
          `${row.product_id}:${row.location_id}:${row.area_id ?? 'root'}`,
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
    categories,
    locations,
    areas,
    suppliers,
    productsBySku,
    inventoryByKey,
  };
}

type InMemoryImportState = ReturnType<typeof makeInMemoryRepository>;

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
      standard_cost: null,
      unit: null,
      barcode: null,
      standard_price: null,
      reorder_point: 0,
      primary_supplier_id: null,
      supplier_sku: null,
      is_active: true,
      is_perishable: false,
      notes: null,
      deleted_at: null,
    } as any),
  );
  state.inventoryByKey.set(
    'prod-1:loc-1:root',
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
  const layer = ProductImportService.DefaultWithoutDependencies.pipe(
    Layer.provide(makeTestLayer(ProductImportRepository)(repo)),
  );
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
  options: {
    readonly approvedPlan?: Parameters<
      ProductImportService['importFromCsvContent']
    >[0]['approvedPlan'];
    readonly allowCreateSuppliers?: boolean;
  } = {},
) => {
  const state = makeInMemoryRepository();
  setup?.(state);
  const layer = ProductImportService.DefaultWithoutDependencies.pipe(
    Layer.provide(makeTestLayer(ProductImportRepository)(state.repo)),
  );
  const result = await Effect.runPromise(
    Effect.flatMap(ProductImportService, (service) =>
      service.importFromCsvContent({
        content,
        importType,
        userId: TEST_USER_ID,
        approvedPlan: options.approvedPlan,
        allowCreateSuppliers: options.allowCreateSuppliers,
      }),
    ).pipe(Effect.provide(layer)),
  );
  return { result, state };
};

const runPreviewWithState = async (
  content: string,
  importType: 'auto' | 'normalized-products' | 'sortly-items' = 'auto',
  setup?: (state: ReturnType<typeof makeInMemoryRepository>) => void,
) => {
  const state = makeInMemoryRepository();
  setup?.(state);
  const layer = ProductImportService.DefaultWithoutDependencies.pipe(
    Layer.provide(makeTestLayer(ProductImportRepository)(state.repo)),
  );
  const result = await Effect.runPromise(
    Effect.flatMap(ProductImportService, (service) =>
      service.previewCsvContent({ content, importType }),
    ).pipe(Effect.provide(layer)),
  );
  return { result, state };
};

const failImport = (
  content: string,
  importType: 'auto' | 'normalized-products' | 'sortly-items' = 'auto',
) => {
  const { repo } = makeInMemoryRepository();
  const layer = ProductImportService.DefaultWithoutDependencies.pipe(
    Layer.provide(makeTestLayer(ProductImportRepository)(repo)),
  );
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

  it('previews Sortly imports without creating rows', async () => {
    const { result, state } = await runPreviewWithState(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location,Price
Folder,Spa,FOLDER-1,,,,
Item,Aesop Soap,SORT-1,Aesop,5,Bay I - Shelf 3,
Item,Aesop Soap Copy,SORT-1,Aesop,2,Bay I - Shelf 3,
`,
      'sortly-items',
    );

    expect(result).toMatchObject({
      format: 'sortly-items',
      totalRows: 3,
      itemRows: 2,
      folderRows: 1,
      importableRows: 2,
    });
    expect(result.duplicateSkuConflicts).toHaveLength(1);
    expect(result.locationMappings[0]).toMatchObject({
      sourceLocation: 'Bay I - Shelf 3',
      areaPath: 'Bay I / Shelf 3',
      action: 'create-area',
    });
    expect(result.supplierMappings[0]).toMatchObject({
      supplierName: 'Aesop',
      action: 'create',
    });
    expect(state.categories).toHaveLength(0);
    expect(state.locations).toHaveLength(0);
    expect(state.productsBySku.size).toBe(0);
  });

  it('previews existing area-scoped inventory as an update', async () => {
    const { result } = await runPreviewWithState(
      `sku,name,category_path,location,area_path,quantity
SKU-1,Same Product,Food,Warehouse,Bay I / Shelf 3,8
`,
      'normalized-products',
      (state) => {
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
        state.areas.push(
          makeRow({
            id: 'area-1',
            location_id: 'loc-1',
            parent_id: null,
            name: 'Bay I',
            code: '',
            description: null,
            is_active: true,
          } as any),
          makeRow({
            id: 'area-2',
            location_id: 'loc-1',
            parent_id: 'area-1',
            name: 'Shelf 3',
            code: '',
            description: null,
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
            standard_cost: null,
            unit: null,
            barcode: null,
            standard_price: null,
            reorder_point: 0,
            primary_supplier_id: null,
            supplier_sku: null,
            is_active: true,
            is_perishable: false,
            notes: null,
            deleted_at: null,
          } as any),
        );
        state.inventoryByKey.set(
          'prod-1:loc-1:area-2',
          makeRow({
            id: 'inv-1',
            product_id: 'prod-1',
            location_id: 'loc-1',
            area_id: 'area-2',
            quantity: 4,
            batch_number: '',
            expiry_date: null,
            cost_per_unit: null,
            received_date: null,
          } as any),
        );
      },
    );

    expect(result.inventoryPreviews[0]).toMatchObject({
      row: 2,
      sku: 'SKU-1',
      location: 'Warehouse',
      areaPath: 'Bay I / Shelf 3',
      quantity: 8,
      action: 'update',
    });
  });

  it('creates approved suppliers and links imported products', async () => {
    const { result, state } = await runImportWithState(
      `sku,name,category_path,location,quantity,supplier_name,supplier_sku,supplier_cost
SKU-1,Soap,Amenities,Warehouse,5,Aesop,AES-1,1.25
`,
      'normalized-products',
      undefined,
      { allowCreateSuppliers: true },
    );

    expect(result.suppliersCreated).toBe(1);
    expect(result.productsCreated).toBe(1);
    const product = state.productsBySku.get('SKU-1');
    expect(product).toMatchObject({
      primary_supplier_id: state.suppliers[0].id,
      supplier_sku: 'AES-1',
      standard_cost: 1.25,
    });
  });

  it('creates approved Sortly suppliers from category-root mappings', async () => {
    const { result, state } = await runImportWithState(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location
Item,Aesop Soap,SORT-1,Aesop,5,Warehouse
`,
      'sortly-items',
      undefined,
      {
        allowCreateSuppliers: true,
        approvedPlan: {
          allowCreateSuppliers: true,
          supplierMappings: [
            {
              sourcePattern: 'Aesop',
              supplierName: 'Aesop',
              action: 'create',
              confidence: 0.55,
              rowCount: 1,
            },
          ],
        },
      },
    );

    expect(result.suppliersCreated).toBe(1);
    const product = state.productsBySku.get('SORT-1');
    expect(product).toMatchObject({
      primary_supplier_id: state.suppliers[0].id,
    });
  });

  it('does not create suppliers for ignored approved supplier mappings', async () => {
    const { result, state } = await runImportWithState(
      `sku,name,category_path,location,quantity,supplier_name
SKU-1,Soap,Amenities,Warehouse,5,Aesop
`,
      'normalized-products',
      undefined,
      {
        allowCreateSuppliers: true,
        approvedPlan: {
          allowCreateSuppliers: true,
          supplierMappings: [
            {
              sourcePattern: 'Aesop',
              supplierName: 'Aesop',
              action: 'ignore',
              confidence: 1,
              rowCount: 1,
            },
          ],
        },
      },
    );

    expect(result.suppliersCreated).toBe(0);
    expect(state.suppliers).toHaveLength(0);
    expect(state.productsBySku.get('SKU-1')).toMatchObject({
      primary_supplier_id: null,
    });
  });

  it('preserves existing supplier fields when import rows do not provide supplier values', async () => {
    const { result, state } = await runImportWithState(
      `sku,name,category_path,location,quantity
SKU-1,Same Product,Food,Warehouse,8
`,
      'normalized-products',
      (state) => {
        seedExistingProductWithRootInventory(state);
        state.suppliers.push(
          makeRow({
            id: 'supplier-1',
            name: 'Existing Supplier',
            notes: null,
            is_active: true,
          } as any),
        );
        state.productsBySku.set('SKU-1', {
          ...state.productsBySku.get('SKU-1'),
          primary_supplier_id: 'supplier-1',
          supplier_sku: 'EXISTING-SKU',
          standard_cost: 3.5,
        });
      },
    );

    expect(result.productsUpdated).toBe(0);
    expect(result.inventoryRecordsUpdated).toBe(1);
    expect(state.productsBySku.get('SKU-1')).toMatchObject({
      primary_supplier_id: 'supplier-1',
      supplier_sku: 'EXISTING-SKU',
      standard_cost: 3.5,
    });
  });

  it('imports area-scoped inventory when an approved area path is present', async () => {
    const { result, state } = await runImportWithState(
      `sku,name,category_path,location,area_path,quantity
SKU-1,Soap,Amenities,Main Store,Bay I / Shelf 3,5
`,
      'normalized-products',
    );

    expect(result.areasCreated).toBe(2);
    expect(result.inventoryRecordsCreated).toBe(1);
    const product = state.productsBySku.get('SKU-1');
    const location = state.locations.find((row) => row.name === 'Main Store');
    const shelf = state.areas.find((row) => row.name === 'Shelf 3');
    expect(
      state.inventoryByKey.get(`${product.id}:${location.id}:${shelf.id}`),
    ).toMatchObject({ quantity: 5 });
  });

  it('can derive SKUs for approved conflicting Sortly IDs', async () => {
    const { result, state } = await runImportWithState(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location
Item,Black Glove,SORT-1,Amenities,5,Warehouse
Item,White Glove,SORT-1,Amenities,7,Warehouse
`,
      'sortly-items',
      undefined,
      { approvedPlan: { skuConflictPolicy: 'derive-sku' } },
    );

    expect(result.rowsSkipped).toBe(0);
    expect(result.productsCreated).toBe(2);
    expect([...state.productsBySku.keys()]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^SORT-1-/)]),
    );
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
    expect(state.inventoryByKey.get('prod-1:loc-1:root')).toMatchObject({
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
    expect(state.inventoryByKey.get('prod-1:loc-1:root')).toMatchObject({
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
