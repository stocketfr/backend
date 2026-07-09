import { Effect } from 'effect';
import { LocationType } from '@stocket/types/locations';
import { describe, expect, it } from '@effect/vitest';
import type {
  ImportAreaRow,
  ImportCaches,
  ImportCategoryRow,
  ImportInventoryRow,
  ImportLocationRow,
  ImportProductRow,
  NormalizedProductImportRow,
} from '../types';
import { makeEmptyProductImportResult } from '../utils/result';
import {
  importProductRow,
  type ProductImportPhotoImporterPort,
  type ProductImportRowRepository,
} from './import';

const TEST_USER_ID = '00000000-0000-4000-a000-000000000001';
const now = new Date('2026-01-01T00:00:00.000Z');

const makeCaches = (): ImportCaches => ({
  categories: new Map(),
  locations: new Map(),
  areas: new Map(),
  products: new Map(),
  photoUrlsByProduct: new Map(),
});

const row = (
  overrides: Partial<NormalizedProductImportRow> = {},
): NormalizedProductImportRow => ({
  sourceRow: 2,
  sku: 'SKU-1',
  name: 'Same Product',
  category_path: 'Food',
  reorder_point: '2',
  quantity: '7',
  location: 'Warehouse',
  unit: 'bottle',
  standard_price: '12.50',
  barcode: 'BAR-1',
  description: 'Imported product',
  notes: 'Imported note',
  is_active: 'true',
  is_perishable: 'false',
  expiry_date: '',
  photo_urls: [],
  ...overrides,
});

const categoryRow = (
  overrides: Partial<ImportCategoryRow> & {
    readonly id: string;
    readonly name: string;
    readonly parent_id: string | null;
  },
): ImportCategoryRow => ({
  tenant_id: 'tenant-1',
  description: null,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const locationRow = (
  overrides: Partial<ImportLocationRow> & {
    readonly id: string;
    readonly name: string;
  },
): ImportLocationRow => ({
  tenant_id: 'tenant-1',
  type: LocationType.WAREHOUSE,
  address: '',
  contact_person: '',
  phone: '',
  is_active: true,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const areaRow = (
  overrides: Partial<ImportAreaRow> & {
    readonly id: string;
    readonly location_id: string;
    readonly name: string;
    readonly parent_id: string | null;
  },
): ImportAreaRow => ({
  tenant_id: 'tenant-1',
  code: '',
  description: '',
  is_active: true,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const productRow = (
  overrides: Partial<ImportProductRow> & {
    readonly id: string;
    readonly sku: string;
    readonly name: string;
    readonly category_id: string;
  },
): ImportProductRow => ({
  tenant_id: 'tenant-1',
  description: null,
  volume_ml: null,
  weight_kg: null,
  dimensions_cm: null,
  standard_cost: null,
  standard_price: null,
  markup_percentage: null,
  primary_supplier_id: null,
  supplier_sku: null,
  barcode: null,
  unit: null,
  reorder_point: 0,
  is_active: true,
  is_perishable: false,
  notes: null,
  created_at: now,
  updated_at: now,
  deleted_at: null,
  created_by: null,
  updated_by: null,
  deleted_by: null,
  ...overrides,
});

const inventoryRow = (
  overrides: Partial<ImportInventoryRow> & {
    readonly id: string;
    readonly product_id: string;
    readonly location_id: string;
  },
): ImportInventoryRow => ({
  tenant_id: 'tenant-1',
  area_id: null,
  quantity: 0,
  batch_number: '',
  expiry_date: null,
  cost_per_unit: null,
  received_date: null,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const makePhotoImporter = (failingUrls: ReadonlySet<string> = new Set()) => {
  const calls: Array<{
    readonly productId: string;
    readonly url: string;
    readonly photoIndex: number;
    readonly userId: string;
  }> = [];
  const importer: ProductImportPhotoImporterPort = {
    importSortlyPhoto: (productId, url, photoIndex, userId) =>
      Effect.gen(function* () {
        calls.push({ productId, url, photoIndex, userId });
        if (failingUrls.has(url)) {
          return yield* Effect.fail(new Error('download failed'));
        }
        return { id: `photo-${calls.length}` };
      }),
  };
  return { importer, calls };
};

const makeImportState = () => {
  let nextCategoryId = 1;
  let nextLocationId = 1;
  let nextAreaId = 1;
  let nextProductId = 1;
  let nextInventoryId = 1;
  let hasAreaScopedInventory = false;
  const categories: ImportCategoryRow[] = [];
  const locations: ImportLocationRow[] = [];
  const areas: ImportAreaRow[] = [];
  const productsBySku = new Map<string, ImportProductRow>();
  const inventoryByKey = new Map<string, ImportInventoryRow>();
  const calls = {
    createCategory: 0,
    createLocation: 0,
    createProduct: 0,
    updateProduct: 0,
    createInventory: 0,
    updateInventory: 0,
  };
  const inventoryKey = (
    productId: string,
    locationId: string,
    areaId: string | null = null,
  ) => `${productId}:${locationId}:${areaId ?? 'root'}`;

  const repository = {
    findCategoryByNameAndParent: (name, parentId) =>
      Effect.sync(
        () =>
          categories.find(
            (category) =>
              category.name === name && category.parent_id === parentId,
          ) ?? null,
      ),
    createCategory: (data) =>
      Effect.sync(() => {
        calls.createCategory++;
        const category = categoryRow({
          id: `cat-${nextCategoryId++}`,
          name: data.name,
          parent_id: data.parent_id,
          description: data.description,
        });
        categories.push(category);
        return category;
      }),
    findLocationByName: (name) =>
      Effect.sync(
        () => locations.find((location) => location.name === name) ?? null,
      ),
    findLocationById: (locationId) =>
      Effect.sync(
        () => locations.find((location) => location.id === locationId) ?? null,
      ),
    createLocation: (data) =>
      Effect.sync(() => {
        calls.createLocation++;
        const location = locationRow({
          id: `loc-${nextLocationId++}`,
          name: data.name,
          type: data.type,
        });
        locations.push(location);
        return location;
      }),
    findAreaByNameLocationAndParent: (locationId, name, parentId) =>
      Effect.sync(
        () =>
          areas.find(
            (area) =>
              area.location_id === locationId &&
              area.name === name &&
              area.parent_id === parentId,
          ) ?? null,
      ),
    createArea: (data) =>
      Effect.sync(() => {
        const area = areaRow({
          id: `area-${nextAreaId++}`,
          location_id: data.location_id,
          name: data.name,
          parent_id: data.parent_id,
          description: data.description,
          code: data.code,
          is_active: data.is_active,
        });
        areas.push(area);
        return area;
      }),
    findProductBySku: (sku) =>
      Effect.sync(() => productsBySku.get(sku) ?? null),
    createProduct: (data) =>
      Effect.sync(() => {
        calls.createProduct++;
        const product = productRow({
          id: `prod-${nextProductId++}`,
          ...data,
        });
        productsBySku.set(product.sku, product);
        return product;
      }),
    updateProduct: (productId, data) =>
      Effect.sync(() => {
        for (const [sku, product] of productsBySku.entries()) {
          if (product.id === productId) {
            calls.updateProduct++;
            const updated = productRow({ ...product, ...data });
            productsBySku.set(sku, updated);
            return updated;
          }
        }
        return null;
      }),
    findInventoryByProductLocationAndArea: (productId, locationId, areaId) =>
      Effect.sync(
        () =>
          inventoryByKey.get(inventoryKey(productId, locationId, areaId)) ??
          null,
      ),
    hasAreaScopedInventoryForProductAndLocation: () =>
      Effect.sync(() => hasAreaScopedInventory),
    createInventory: (data) =>
      Effect.sync(() => {
        calls.createInventory++;
        const inventory = inventoryRow({
          id: `inv-${nextInventoryId++}`,
          ...data,
        });
        inventoryByKey.set(
          inventoryKey(
            inventory.product_id,
            inventory.location_id,
            inventory.area_id,
          ),
          inventory,
        );
        return inventory;
      }),
    updateInventory: (inventoryId, data) =>
      Effect.sync(() => {
        for (const [key, inventory] of inventoryByKey.entries()) {
          if (inventory.id === inventoryId) {
            calls.updateInventory++;
            inventoryByKey.delete(key);
            const updated = inventoryRow({ ...inventory, ...data });
            inventoryByKey.set(
              inventoryKey(
                updated.product_id,
                updated.location_id,
                updated.area_id,
              ),
              updated,
            );
            return updated;
          }
        }
        return null;
      }),
  } satisfies ProductImportRowRepository;

  return {
    repository,
    categories,
    locations,
    productsBySku,
    inventoryByKey,
    calls,
    inventoryKey,
    setHasAreaScopedInventory: (value: boolean) => {
      hasAreaScopedInventory = value;
    },
  };
};

describe('importProductRow', () => {
  it.effect(
    'creates category, location, product, and inventory records for a new row',
    () =>
      Effect.gen(function* () {
        const state = makeImportState();
        const { importer } = makePhotoImporter();
        const result = makeEmptyProductImportResult();
        const caches = makeCaches();

        yield* importProductRow({
          repository: state.repository,
          photoImporter: importer,
          row: row(),
          caches,
          result,
          expiryDate: null,
          userId: TEST_USER_ID,
          approvedPlan: undefined,
        });

        const product = state.productsBySku.get('SKU-1');
        expect(product).toBeDefined();
        if (!product) return;
        expect(result.categoriesCreated).toBe(1);
        expect(result.locationsCreated).toBe(1);
        expect(result.productsCreated).toBe(1);
        expect(result.inventoryRecordsCreated).toBe(1);
        expect(product).toMatchObject({
          name: 'Same Product',
          category_id: 'cat-1',
          standard_price: 12.5,
          reorder_point: 2,
          created_by: TEST_USER_ID,
          updated_by: TEST_USER_ID,
        });
        expect(
          state.inventoryByKey.get(state.inventoryKey(product.id, 'loc-1')),
        ).toMatchObject({ quantity: 7, area_id: null });
      }),
  );

  it.effect('updates changed existing products and inventory records', () =>
    Effect.gen(function* () {
      const state = makeImportState();
      const { importer } = makePhotoImporter();
      const result = makeEmptyProductImportResult();
      const caches = makeCaches();
      state.categories.push(
        categoryRow({ id: 'cat-1', name: 'Food', parent_id: null }),
      );
      state.locations.push(locationRow({ id: 'loc-1', name: 'Warehouse' }));
      state.productsBySku.set(
        'SKU-1',
        productRow({
          id: 'prod-1',
          sku: 'SKU-1',
          name: 'Old Product',
          category_id: 'cat-1',
        }),
      );
      state.inventoryByKey.set(
        state.inventoryKey('prod-1', 'loc-1'),
        inventoryRow({
          id: 'inv-1',
          product_id: 'prod-1',
          location_id: 'loc-1',
          quantity: 1,
          expiry_date: new Date('2025-01-01T00:00:00.000Z'),
        }),
      );
      const expiryDate = new Date('2026-06-01T00:00:00.000Z');

      yield* importProductRow({
        repository: state.repository,
        photoImporter: importer,
        row: row({ quantity: '11' }),
        caches,
        result,
        expiryDate,
        userId: TEST_USER_ID,
        approvedPlan: undefined,
      });

      expect(result.categoriesCreated).toBe(0);
      expect(result.locationsCreated).toBe(0);
      expect(result.productsUpdated).toBe(1);
      expect(result.inventoryRecordsUpdated).toBe(1);
      expect(state.productsBySku.get('SKU-1')).toMatchObject({
        name: 'Same Product',
        updated_by: TEST_USER_ID,
      });
      expect(
        state.inventoryByKey.get(state.inventoryKey('prod-1', 'loc-1')),
      ).toMatchObject({ quantity: 11, expiry_date: expiryDate });
    }),
  );

  it.effect(
    'fails before product writes when root inventory conflicts with area inventory',
    () =>
      Effect.gen(function* () {
        const state = makeImportState();
        const { importer } = makePhotoImporter();
        const result = makeEmptyProductImportResult();
        const caches = makeCaches();
        state.locations.push(locationRow({ id: 'loc-1', name: 'Warehouse' }));
        state.productsBySku.set(
          'SKU-1',
          productRow({
            id: 'prod-1',
            sku: 'SKU-1',
            name: 'Old Product',
            category_id: 'cat-1',
          }),
        );
        state.setHasAreaScopedInventory(true);

        const error = yield* Effect.flip(
          importProductRow({
            repository: state.repository,
            photoImporter: importer,
            row: row({ category_path: 'Drinks' }),
            caches,
            result,
            expiryDate: null,
            userId: TEST_USER_ID,
            approvedPlan: undefined,
          }),
        );

        expect(error).toMatchObject({
          _tag: 'ProductInfrastructureError',
          messageKey: 'products.importAreaScopedInventoryConflict',
        });
        expect(result.categoriesCreated).toBe(0);
        expect(result.productsUpdated).toBe(0);
        expect(state.calls.createCategory).toBe(0);
        expect(state.calls.updateProduct).toBe(0);
        expect(state.calls.createInventory).toBe(0);
      }),
  );

  it.effect(
    'imports supported photos once and records unsupported or failed URLs',
    () =>
      Effect.gen(function* () {
        const state = makeImportState();
        const failingUrl = 'https://lnk.sortly.co/fail';
        const { importer, calls } = makePhotoImporter(new Set([failingUrl]));
        const result = makeEmptyProductImportResult();
        const caches = makeCaches();

        yield* importProductRow({
          repository: state.repository,
          photoImporter: importer,
          row: row({
            location: '',
            photo_urls: [
              'https://lnk.sortly.co/ok',
              failingUrl,
              'https://example.com/nope',
              'https://lnk.sortly.co/ok',
            ],
          }),
          caches,
          result,
          expiryDate: null,
          userId: TEST_USER_ID,
          approvedPlan: undefined,
        });

        expect(result.photosCreated).toBe(1);
        expect(result.photosSkipped).toBe(2);
        expect(calls.map((call) => call.url)).toEqual([
          'https://lnk.sortly.co/ok',
          failingUrl,
        ]);
        expect(result.errors).toEqual([
          {
            row: 2,
            error:
              'Photo import failed for "https://lnk.sortly.co/fail": download failed',
          },
          {
            row: 2,
            error:
              'Photo import failed for "https://example.com/nope": Unsupported Sortly photo URL',
          },
        ]);
      }),
  );
});
