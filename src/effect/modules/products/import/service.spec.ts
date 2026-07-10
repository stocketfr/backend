import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type {
  ProductImportAiProposalDto,
  ProductImportApprovedPlanDto,
  ProductImportPreviewDto,
} from '@stocket/types/products';
import { makeTestLayer } from '../../../testing/utils';
import { ProductImportRepository } from './repository';
import type { ProductImportPlan } from './types';
import {
  detectProductImportFormat,
  normalizeProductImportRecords,
  sortlyPhotoSourceKey,
} from './utils/csv';
import { makeProductImportProposal } from './utils/proposal';
import { parseDate, parseProductImportNumber } from './utils/value-parsers';
import { ProductImportLlmProposer } from './llm-proposer';
import { ProductImportPhotoImporter } from './photo-importer';
import { ProductImportService } from './service';

const TEST_USER_ID = '00000000-0000-4000-a000-000000000001';

const makeLlmProposer = (
  overrides: Partial<ProductImportLlmProposer> = {},
) => ({
  propose: vi.fn((preview: ProductImportPreviewDto) =>
    Effect.succeed(makeProductImportProposal(preview)),
  ),
  ...overrides,
});

const makePhotoImporter = (
  overrides: Partial<ProductImportPhotoImporter> = {},
) => ({
  importSortlyPhoto: vi.fn(() =>
    Effect.succeed({
      id: 'photo-1',
      product_id: 'prod-1',
      filename: 'sortly-photo-1.jpg',
      mimetype: 'image/jpeg',
      size: 4,
      uploaded_by: TEST_USER_ID,
      display_order: 0,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    }),
  ),
  ...overrides,
});

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
    findLocationById: vi.fn((locationId: string) =>
      Effect.sync(
        () => locations.find((location) => location.id === locationId) ?? null,
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
      (locationId: string, name: string, parentId: string | null) =>
        Effect.sync(
          () =>
            areas.find(
              (area) =>
                area.location_id === locationId &&
                area.name === name &&
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
    findRootInventoryByProductAndLocation: vi.fn(
      (productId: string, locationId: string) =>
        Effect.sync(
          () => inventoryByKey.get(inventoryKey(productId, locationId)) ?? null,
        ),
    ),
    findInventoryByProductLocationAndArea: vi.fn(
      (productId: string, locationId: string, areaId: string | null) =>
        Effect.sync(
          () =>
            inventoryByKey.get(inventoryKey(productId, locationId, areaId)) ??
            null,
        ),
    ),
    hasAreaScopedInventoryForProductAndLocation: vi.fn(() =>
      Effect.succeed(false),
    ),
    createInventory: vi.fn((data: any) =>
      Effect.sync(() => {
        const row = makeRow({ id: id('inv'), area_id: null, ...data } as any);
        inventoryByKey.set(
          inventoryKey(row.product_id, row.location_id, row.area_id),
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
    productsBySku,
    inventoryByKey,
    inventoryKey,
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
  approvedPlan?: ProductImportPlan,
) => {
  const { repo } = makeInMemoryRepository();
  const llmProposer = makeLlmProposer();
  const photoImporter = makePhotoImporter();
  const layer = ProductImportService.DefaultWithoutDependencies.pipe(
    Layer.provide(
      Layer.mergeAll(
        makeTestLayer(ProductImportRepository)(repo),
        makeTestLayer(ProductImportLlmProposer)(llmProposer),
        makeTestLayer(ProductImportPhotoImporter)(photoImporter),
      ),
    ),
  );
  return Effect.runPromise(
    Effect.flatMap(ProductImportService, (service) =>
      service.importFromCsvContent({
        content,
        importType,
        approvedPlan,
        userId: TEST_USER_ID,
      }),
    ).pipe(Effect.provide(layer)),
  );
};

const runImportWithState = async (
  content: string,
  importType: 'auto' | 'normalized-products' | 'sortly-items' = 'auto',
  setup?: (state: ReturnType<typeof makeInMemoryRepository>) => void,
  approvedPlan?: ProductImportPlan,
  photoImporter = makePhotoImporter(),
) => {
  const state = makeInMemoryRepository();
  const llmProposer = makeLlmProposer();
  setup?.(state);
  const layer = ProductImportService.DefaultWithoutDependencies.pipe(
    Layer.provide(
      Layer.mergeAll(
        makeTestLayer(ProductImportRepository)(state.repo),
        makeTestLayer(ProductImportLlmProposer)(llmProposer),
        makeTestLayer(ProductImportPhotoImporter)(photoImporter),
      ),
    ),
  );
  const result = await Effect.runPromise(
    Effect.flatMap(ProductImportService, (service) =>
      service.importFromCsvContent({
        content,
        importType,
        approvedPlan,
        userId: TEST_USER_ID,
      }),
    ).pipe(Effect.provide(layer)),
  );
  return { result, state, photoImporter };
};

const failImport = (
  content: string,
  importType: 'auto' | 'normalized-products' | 'sortly-items' = 'auto',
) => {
  const { repo } = makeInMemoryRepository();
  const llmProposer = makeLlmProposer();
  const photoImporter = makePhotoImporter();
  const layer = ProductImportService.DefaultWithoutDependencies.pipe(
    Layer.provide(
      Layer.mergeAll(
        makeTestLayer(ProductImportRepository)(repo),
        makeTestLayer(ProductImportLlmProposer)(llmProposer),
        makeTestLayer(ProductImportPhotoImporter)(photoImporter),
      ),
    ),
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

const runPreview = (
  content: string,
  importType: 'auto' | 'normalized-products' | 'sortly-items' = 'auto',
) => {
  const { repo } = makeInMemoryRepository();
  const llmProposer = makeLlmProposer();
  const photoImporter = makePhotoImporter();
  const layer = ProductImportService.DefaultWithoutDependencies.pipe(
    Layer.provide(
      Layer.mergeAll(
        makeTestLayer(ProductImportRepository)(repo),
        makeTestLayer(ProductImportLlmProposer)(llmProposer),
        makeTestLayer(ProductImportPhotoImporter)(photoImporter),
      ),
    ),
  );
  return Effect.runPromise(
    Effect.flatMap(ProductImportService, (service) =>
      service.previewCsvContent({ content, importType }),
    ).pipe(Effect.provide(layer)),
  );
};

const runProposal = (
  content: string,
  importType: 'auto' | 'normalized-products' | 'sortly-items' = 'auto',
  llmProposer = makeLlmProposer(),
) => {
  const { repo } = makeInMemoryRepository();
  const photoImporter = makePhotoImporter();
  const layer = ProductImportService.DefaultWithoutDependencies.pipe(
    Layer.provide(
      Layer.mergeAll(
        makeTestLayer(ProductImportRepository)(repo),
        makeTestLayer(ProductImportLlmProposer)(llmProposer),
        makeTestLayer(ProductImportPhotoImporter)(photoImporter),
      ),
    ),
  );
  return Effect.runPromise(
    Effect.flatMap(ProductImportService, (service) =>
      service.proposeImportPlan({ content, importType }),
    ).pipe(Effect.provide(layer)),
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

  it('normalizes Sortly photo sources independently of signed query parameters', () => {
    expect(
      sortlyPhotoSourceKey(
        'https://LNK.SORTLY.CO/v2/downloads/photo/photo-1/?token=first',
      ),
    ).toBe('lnk.sortly.co/v2/downloads/photo/photo-1');
    expect(
      sortlyPhotoSourceKey(
        'https://lnk.sortly.co/v2/downloads/photo/photo-1?token=second',
      ),
    ).toBe('lnk.sortly.co/v2/downloads/photo/photo-1');
    expect(sortlyPhotoSourceKey('https://example.com/photo-1')).toBeNull();
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

  it('derives SKUs for approved conflicting duplicate Sortly SIDs', async () => {
    const { result, state } = await runImportWithState(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location,Min Level
Item,Service Gloves Black,SORT-1,Accessories,6,Warehouse,2
Item,Service Gloves White,SORT-1,Accessories,12,Warehouse,2
Item,Service Gloves Black,SORT-1,Accessories,3,Bar,2
`,
      'sortly-items',
      undefined,
      { skuConflictPolicy: 'derive-sku' },
    );

    expect(result.rowsSkipped).toBe(0);
    expect(result.productsCreated).toBe(2);
    expect(result.inventoryRecordsCreated).toBe(3);
    expect(result.errors).toEqual([]);
    expect([...state.productsBySku.keys()].sort()).toEqual([
      'SORT-1-SERVICE-GLOVES-BLACK',
      'SORT-1-SERVICE-GLOVES-WHITE',
    ]);

    const blackProduct = state.productsBySku.get('SORT-1-SERVICE-GLOVES-BLACK');
    const whiteProduct = state.productsBySku.get('SORT-1-SERVICE-GLOVES-WHITE');
    const warehouse = state.locations.find(
      (location) => location.name === 'Warehouse',
    );
    const bar = state.locations.find((location) => location.name === 'Bar');

    expect(blackProduct).toMatchObject({ name: 'Service Gloves Black' });
    expect(whiteProduct).toMatchObject({ name: 'Service Gloves White' });
    expect(
      state.inventoryByKey.get(
        state.inventoryKey(blackProduct.id, warehouse.id),
      ),
    ).toMatchObject({ quantity: 6 });
    expect(
      state.inventoryByKey.get(state.inventoryKey(blackProduct.id, bar.id)),
    ).toMatchObject({ quantity: 3 });
    expect(
      state.inventoryByKey.get(
        state.inventoryKey(whiteProduct.id, warehouse.id),
      ),
    ).toMatchObject({ quantity: 12 });
  });

  it('derives SKUs when an AI proposal is submitted as the import plan', async () => {
    const aiProposalPlan = {
      format: 'sortly-items',
      confidence: 0.92,
      productIdentity: {
        sourceColumn: 'SID',
        conflictPolicy: 'derive-sku',
      },
      categoryMappings: [],
      supplierMappings: [],
      locationMappings: [],
      warnings: [],
    } satisfies ProductImportAiProposalDto;
    const { result, state } = await runImportWithState(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location,Min Level
Item,Service Gloves Black,SORT-1,Accessories,6,Warehouse,2
Item,Service Gloves White,SORT-1,Accessories,12,Warehouse,2
`,
      'sortly-items',
      undefined,
      aiProposalPlan,
    );

    expect(result.rowsSkipped).toBe(0);
    expect(result.productsCreated).toBe(2);
    expect(result.inventoryRecordsCreated).toBe(2);
    expect(result.errors).toEqual([]);
    expect([...state.productsBySku.keys()].sort()).toEqual([
      'SORT-1-SERVICE-GLOVES-BLACK',
      'SORT-1-SERVICE-GLOVES-WHITE',
    ]);
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

  it('applies approved location mappings as area-scoped inventory', async () => {
    const approvedPlan = {
      defaultLocationName: 'Main Warehouse',
      locationMappings: [
        {
          sourceLocation: 'Bay I - Shelf 3 - Bin A',
          targetLocationName: 'Main Warehouse',
          areaPath: 'Bay I / Shelf 3 / Bin A',
          action: 'create-area',
          confidence: 0.9,
          rowCount: 1,
        },
      ],
      categoryMappings: [
        {
          sourcePath: 'Uncategorized',
          targetPath: 'Needs Review / Uncategorized',
          action: 'default',
          rowCount: 1,
        },
      ],
    } satisfies ProductImportApprovedPlanDto;
    const { result, state } = await runImportWithState(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location
Item,Imported Tonic,SORT-1,,12,Bay I  - Shelf 3 - Bin A
`,
      'sortly-items',
      undefined,
      approvedPlan,
    );
    const product = state.productsBySku.get('SORT-1');
    const location = state.locations.find(
      (candidate) => candidate.name === 'Main Warehouse',
    );
    const bayArea = state.areas.find((candidate) => candidate.name === 'Bay I');
    const shelfArea = state.areas.find(
      (candidate) => candidate.name === 'Shelf 3',
    );
    const binArea = state.areas.find((candidate) => candidate.name === 'Bin A');

    expect(result).toMatchObject({
      categoriesCreated: 2,
      locationsCreated: 1,
      areasCreated: 3,
      productsCreated: 1,
      inventoryRecordsCreated: 1,
      rowsSkipped: 0,
      errors: [],
    });
    expect(state.locations.map((candidate) => candidate.name)).toEqual([
      'Main Warehouse',
    ]);
    expect(bayArea).toMatchObject({
      location_id: location.id,
      parent_id: null,
      name: 'Bay I',
    });
    expect(shelfArea).toMatchObject({
      location_id: location.id,
      parent_id: bayArea.id,
      name: 'Shelf 3',
    });
    expect(binArea).toMatchObject({
      location_id: location.id,
      parent_id: shelfArea.id,
      name: 'Bin A',
    });
    expect(
      state.inventoryByKey.get(
        state.inventoryKey(product.id, location.id, binArea.id),
      ),
    ).toMatchObject({
      product_id: product.id,
      location_id: location.id,
      area_id: binArea.id,
      quantity: 12,
    });
  });

  it('imports supported Sortly photo URLs for imported products', async () => {
    const photoImporter = makePhotoImporter();
    const { result, state } = await runImportWithState(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location,Photo1,Photo2
Item,Imported Tonic,SORT-1,Drinks,12,Bar,https://lnk.sortly.co/v2/downloads/photo/photo-1,https://lnk.sortly.co/v2/downloads/photo/photo-2
`,
      'sortly-items',
      undefined,
      undefined,
      photoImporter,
    );
    const product = state.productsBySku.get('SORT-1');

    expect(result.rowsSkipped).toBe(0);
    expect(result.productsCreated).toBe(1);
    expect(result.inventoryRecordsCreated).toBe(1);
    expect(result.photosCreated).toBe(2);
    expect(result.photosSkipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(photoImporter.importSortlyPhoto).toHaveBeenNthCalledWith(
      1,
      product.id,
      'https://lnk.sortly.co/v2/downloads/photo/photo-1',
      0,
      TEST_USER_ID,
    );
    expect(photoImporter.importSortlyPhoto).toHaveBeenNthCalledWith(
      2,
      product.id,
      'https://lnk.sortly.co/v2/downloads/photo/photo-2',
      1,
      TEST_USER_ID,
    );
  });

  it('skips unsupported Sortly photo URLs without skipping the product row', async () => {
    const photoImporter = makePhotoImporter();
    const { result } = await runImportWithState(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location,Photo1
Item,Imported Tonic,SORT-1,Drinks,12,Bar,https://example.test/photo.jpg
`,
      'sortly-items',
      undefined,
      undefined,
      photoImporter,
    );

    expect(result.rowsSkipped).toBe(0);
    expect(result.productsCreated).toBe(1);
    expect(result.inventoryRecordsCreated).toBe(1);
    expect(result.photosCreated).toBe(0);
    expect(result.photosSkipped).toBe(1);
    expect(result.errors).toEqual([
      {
        row: 2,
        error:
          'Photo import failed for "https://example.test/photo.jpg": Unsupported Sortly photo URL',
      },
    ]);
    expect(photoImporter.importSortlyPhoto).not.toHaveBeenCalled();
  });

  it('keeps imported product data when photo import fails', async () => {
    const photoImporter = makePhotoImporter({
      importSortlyPhoto: vi.fn(() => Effect.fail(new Error('network down'))),
    });
    const { result } = await runImportWithState(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location,Photo1
Item,Imported Tonic,SORT-1,Drinks,12,Bar,https://lnk.sortly.co/v2/downloads/photo/photo-1
`,
      'sortly-items',
      undefined,
      undefined,
      photoImporter,
    );

    expect(result.rowsSkipped).toBe(0);
    expect(result.productsCreated).toBe(1);
    expect(result.inventoryRecordsCreated).toBe(1);
    expect(result.photosCreated).toBe(0);
    expect(result.photosSkipped).toBe(1);
    expect(result.errors).toEqual([
      {
        row: 2,
        error:
          'Photo import failed for "https://lnk.sortly.co/v2/downloads/photo/photo-1": network down',
      },
    ]);
  });

  it('previews Sortly folders, duplicate SID conflicts, photos, and area-like storage', async () => {
    const preview = await runPreview(
      `Entry Type,Entry Name,SID,Primary Folder,Subfolder-level1,Quantity,Location,Photo1,Expiry Date
Folder,Spa,FOLDER-1,Spa,,,,,
Item,Service Gloves Black,SORT-1,Accessories,,6,Bay I  - Shelf 3,https://example.test/photo.jpg,
Item,Service Gloves White,SORT-1,Accessories,,12,Bay I - Shelf 3,,
Item,Nail File,SORT-2,Spa,Nails,4,,,
`,
      'sortly-items',
    );

    expect(preview).toMatchObject({
      format: 'sortly-items',
      totalRows: 4,
      itemRows: 3,
      folderRows: 1,
      importableRows: 1,
      missingRequiredRows: 0,
    });
    expect(preview.duplicateSkuConflicts).toEqual([
      {
        sku: 'SORT-1',
        rows: [3, 4],
        names: ['Service Gloves Black', 'Service Gloves White'],
      },
    ]);
    expect(preview.locationMappings).toContainEqual({
      sourceLocation: 'Bay I - Shelf 3',
      areaPath: 'Bay I / Shelf 3',
      action: 'create-area',
      confidence: 0.9,
      rowCount: 2,
    });
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'sku', severity: 'error' }),
        expect.objectContaining({ field: 'photos' }),
        expect.objectContaining({ field: 'location' }),
      ]),
    );
  });

  it('previews nested Sortly storage values as area paths', async () => {
    const preview = await runPreview(
      `Entry Type,Entry Name,SID,Primary Folder,Quantity,Location
Item,Body Lotion,SORT-NESTED-1,Amenities,3,Bay I - Shelf 3 - Bin A
Item,Hand Soap,SORT-NESTED-2,Amenities,2,Bay I Shelf 4
`,
      'sortly-items',
    );

    expect(preview.locationMappings).toEqual(
      expect.arrayContaining([
        {
          sourceLocation: 'Bay I - Shelf 3 - Bin A',
          areaPath: 'Bay I / Shelf 3 / Bin A',
          action: 'create-area',
          confidence: 0.9,
          rowCount: 1,
        },
        {
          sourceLocation: 'Bay I Shelf 4',
          areaPath: 'Bay I / Shelf 4',
          action: 'create-area',
          confidence: 0.9,
          rowCount: 1,
        },
      ]),
    );
    expect(preview.inventoryPreviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sku: 'SORT-NESTED-1',
          location: 'Bay I - Shelf 3 - Bin A',
          areaPath: 'Bay I / Shelf 3 / Bin A',
          action: 'create',
        }),
        expect.objectContaining({
          sku: 'SORT-NESTED-2',
          location: 'Bay I Shelf 4',
          areaPath: 'Bay I / Shelf 4',
          action: 'create',
        }),
      ]),
    );
  });

  it('proposes category cleanup and duplicate SKU derivation for review', async () => {
    const proposal = await runProposal(
      `Entry Type,Entry Name,SID,Primary Folder,Subfolder-level1,Quantity,Location
Item,Toothbrush Moss,SORT-1,Accessories,Dental,1,Bay F - Shelf 2 - Bin A
Item,Toothbrush White,SORT-1,Accessories,Dental,1,Bay F - Shelf 2 - Bin A
Item,Shampoo,SORT-2,Bulgari,Green Tea,5,Bay C - Shelf 3
`,
      'sortly-items',
    );

    expect(proposal.productIdentity).toEqual({
      sourceColumn: 'SID',
      conflictPolicy: 'derive-sku',
    });
    expect(proposal.categoryMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: 'Accessories / Dental',
          targetPath: 'Guest Accessories / Dental',
        }),
      ]),
    );
    expect(proposal.locationMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceLocation: 'Bay F - Shelf 2 - Bin A',
          areaPath: 'Bay F / Shelf 2 / Bin A',
          action: 'create-area',
        }),
      ]),
    );
  });

  it('delegates reviewed proposals to the LLM proposer after deterministic preview', async () => {
    const llmProposer = makeLlmProposer({
      propose: vi.fn((preview: ProductImportPreviewDto) =>
        Effect.succeed({
          ...makeProductImportProposal(preview),
          confidence: 0.99,
          categoryMappings: preview.categoryMappings.map((mapping) => ({
            ...mapping,
            targetPath: 'AI Suggested / Category',
          })),
        }),
      ),
    });
    const proposal = await runProposal(
      `sku,name,category_path,quantity,location
SKU-1,Whisky,Bar,2,Warehouse
`,
      'normalized-products',
      llmProposer,
    );

    expect(llmProposer.propose).toHaveBeenCalledTimes(1);
    expect(llmProposer.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'normalized-products',
        itemRows: 1,
      }),
    );
    expect(proposal.confidence).toBe(0.99);
    expect(proposal.categoryMappings).toEqual([
      expect.objectContaining({ targetPath: 'AI Suggested / Category' }),
    ]);
  });
});
