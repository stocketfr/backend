import { Effect } from 'effect';
import { LocationType } from '@stocket/types/locations';
import { describe, expect, it } from '@effect/vitest';
import type {
  ImportAreaRow,
  ImportCaches,
  ImportCategoryRow,
  ImportLocationRow,
  NormalizedProductImportRow,
  ProductImportPlan,
} from '../types';
import { makeEmptyProductImportResult } from '../utils/result';
import { getOrCreateCategoryPath } from './category';
import { resolveInventoryTarget } from './inventory';
import type { ProductImportTargetRepository } from './types';

const now = new Date('2026-01-01T00:00:00.000Z');

const makeCaches = (): ImportCaches => ({
  categories: new Map<string, string>(),
  locations: new Map<string, string>(),
  areas: new Map<string, string>(),
  products: new Map(),
  photoUrlsByProduct: new Map(),
});

const row = (
  overrides: Partial<NormalizedProductImportRow> = {},
): NormalizedProductImportRow => ({
  sourceRow: 2,
  sku: 'SKU-1',
  name: 'Spa Oil',
  category_path: 'Spa / Oils',
  reorder_point: '0',
  quantity: '1',
  location: 'Main Warehouse - Shelf 2',
  unit: '',
  standard_price: '',
  barcode: '',
  description: '',
  notes: '',
  is_active: 'true',
  is_perishable: 'false',
  expiry_date: '',
  photo_urls: [],
  ...overrides,
});

const categoryRow = (
  overrides: {
    readonly id: string;
    readonly name: string;
    readonly parent_id: string | null;
    readonly description?: string | null;
  },
): ImportCategoryRow => ({
  id: overrides.id,
  tenant_id: 'tenant-1',
  name: overrides.name,
  parent_id: overrides.parent_id,
  description: overrides.description ?? null,
  created_at: now,
  updated_at: now,
});

const locationRow = (
  overrides: {
    readonly id: string;
    readonly name: string;
    readonly type?: LocationType;
  },
): ImportLocationRow => ({
  id: overrides.id,
  tenant_id: 'tenant-1',
  name: overrides.name,
  type: overrides.type ?? LocationType.WAREHOUSE,
  address: '',
  contact_person: '',
  phone: '',
  is_active: true,
  created_at: now,
  updated_at: now,
});

const areaRow = (
  overrides: {
    readonly id: string;
    readonly location_id: string;
    readonly name: string;
    readonly parent_id: string | null;
  },
): ImportAreaRow => ({
  id: overrides.id,
  tenant_id: 'tenant-1',
  location_id: overrides.location_id,
  parent_id: overrides.parent_id,
  name: overrides.name,
  code: '',
  description: '',
  is_active: true,
  created_at: now,
  updated_at: now,
});

const makeTargetState = () => {
  let nextCategoryId = 1;
  let nextLocationId = 1;
  let nextAreaId = 1;
  const categories: ImportCategoryRow[] = [];
  const locations: ImportLocationRow[] = [];
  const areas: ImportAreaRow[] = [];
  const calls = {
    findCategoryByNameAndParent: 0,
    createCategory: 0,
    findLocationByName: 0,
    findLocationById: 0,
    createLocation: 0,
    findAreaByNameLocationAndParent: 0,
    createArea: 0,
  };

  const repository = {
    findCategoryByNameAndParent: (name, parentId) =>
      Effect.sync(() => {
        calls.findCategoryByNameAndParent++;
        return (
          categories.find(
            (category) =>
              category.name === name && category.parent_id === parentId,
          ) ?? null
        );
      }),
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
      Effect.sync(() => {
        calls.findLocationByName++;
        return (
          locations.find((location) => location.name === name) ?? null
        );
      }),
    findLocationById: (locationId) =>
      Effect.sync(() => {
        calls.findLocationById++;
        return (
          locations.find((location) => location.id === locationId) ?? null
        );
      }),
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
      Effect.sync(() => {
        calls.findAreaByNameLocationAndParent++;
        return (
          areas.find(
            (area) =>
              area.location_id === locationId &&
              area.name === name &&
              area.parent_id === parentId,
          ) ?? null
        );
      }),
    createArea: (data) =>
      Effect.sync(() => {
        calls.createArea++;
        const area = areaRow({
          id: `area-${nextAreaId++}`,
          location_id: data.location_id,
          name: data.name,
          parent_id: data.parent_id,
        });
        areas.push(area);
        return area;
      }),
  } satisfies ProductImportTargetRepository;

  return {
    repository,
    categories,
    locations,
    areas,
    calls,
  };
};

describe('product import target resolution', () => {
  it.effect('creates category paths once and reuses the category cache', () =>
    Effect.gen(function* () {
      const state = makeTargetState();
      const result = makeEmptyProductImportResult();
      const caches = makeCaches();

      const categoryId = yield* getOrCreateCategoryPath({
        repository: state.repository,
        categoryPath: 'Spa / Oils',
        caches,
        result,
      });
      const cachedCategoryId = yield* getOrCreateCategoryPath({
        repository: state.repository,
        categoryPath: 'Spa / Oils',
        caches,
        result,
      });

      expect(categoryId).toBe('cat-2');
      expect(cachedCategoryId).toBe('cat-2');
      expect(result.categoriesCreated).toBe(2);
      expect(state.categories.map((category) => category.name)).toEqual([
        'Spa',
        'Oils',
      ]);
      expect(state.calls.findCategoryByNameAndParent).toBe(2);
      expect(state.calls.createCategory).toBe(2);
    }),
  );

  it.effect('creates mapped area paths under the resolved location', () =>
    Effect.gen(function* () {
      const state = makeTargetState();
      const result = makeEmptyProductImportResult();
      const caches = makeCaches();
      const plan = {
        defaultLocationName: 'Fallback Warehouse',
        locationMappings: [
          {
            sourceLocation: 'Main Warehouse - Shelf 2',
            targetLocationName: 'Main Warehouse',
            areaPath: 'Shelf 2 / Bin A',
            action: 'create-area' as const,
            confidence: 1,
            rowCount: 1,
          },
        ],
      } satisfies ProductImportPlan;

      const target = yield* resolveInventoryTarget({
        repository: state.repository,
        row: row(),
        caches,
        result,
        approvedPlan: plan,
      });

      expect(target).toEqual({ locationId: 'loc-1', areaId: 'area-2' });
      expect(result.locationsCreated).toBe(1);
      expect(result.areasCreated).toBe(2);
      expect(state.locations.map((location) => location.name)).toEqual([
        'Main Warehouse',
      ]);
      expect(state.areas.map((area) => area.name)).toEqual([
        'Shelf 2',
        'Bin A',
      ]);
    }),
  );

  it.effect('uses an existing mapped location id and caches its name', () =>
    Effect.gen(function* () {
      const state = makeTargetState();
      const result = makeEmptyProductImportResult();
      const caches = makeCaches();
      state.locations.push(
        locationRow({ id: 'loc-existing', name: 'Existing Warehouse' }),
      );
      const plan = {
        locationMappings: [
          {
            sourceLocation: 'Main Warehouse - Shelf 2',
            targetLocationId: 'loc-existing',
            action: 'use-existing' as const,
            confidence: 1,
            rowCount: 1,
          },
        ],
      } satisfies ProductImportPlan;

      const target = yield* resolveInventoryTarget({
        repository: state.repository,
        row: row(),
        caches,
        result,
        approvedPlan: plan,
      });

      expect(target).toEqual({ locationId: 'loc-existing', areaId: null });
      expect(result.locationsCreated).toBe(0);
      expect(state.calls.findLocationById).toBe(1);
      expect(state.calls.createLocation).toBe(0);
      expect(caches.locations.get('Existing Warehouse')).toBe('loc-existing');
    }),
  );

  it.effect('skips blank and ignored locations without repository calls', () =>
    Effect.gen(function* () {
      const state = makeTargetState();
      const result = makeEmptyProductImportResult();
      const caches = makeCaches();
      const ignoredPlan = {
        locationMappings: [
          {
            sourceLocation: 'Main Warehouse - Shelf 2',
            action: 'ignore' as const,
            confidence: 1,
            rowCount: 1,
          },
        ],
      } satisfies ProductImportPlan;

      const blankTarget = yield* resolveInventoryTarget({
        repository: state.repository,
        row: row({ location: '   ' }),
        caches,
        result,
        approvedPlan: undefined,
      });
      const ignoredTarget = yield* resolveInventoryTarget({
        repository: state.repository,
        row: row(),
        caches,
        result,
        approvedPlan: ignoredPlan,
      });

      expect(blankTarget).toEqual({ locationId: null, areaId: null });
      expect(ignoredTarget).toEqual({ locationId: null, areaId: null });
      expect(state.calls.findLocationByName).toBe(0);
      expect(state.calls.findLocationById).toBe(0);
      expect(state.calls.createLocation).toBe(0);
    }),
  );

  it.effect('fails create-area mappings without a resolvable location', () =>
    Effect.gen(function* () {
      const state = makeTargetState();
      const result = makeEmptyProductImportResult();
      const caches = makeCaches();
      const plan = {
        locationMappings: [
          {
            sourceLocation: 'Main Warehouse - Shelf 2',
            targetLocationName: '   ',
            areaPath: 'Shelf 2',
            action: 'create-area' as const,
            confidence: 1,
            rowCount: 1,
          },
        ],
      } satisfies ProductImportPlan;

      const error = yield* Effect.flip(
        resolveInventoryTarget({
          repository: state.repository,
          row: row(),
          caches,
          result,
          approvedPlan: plan,
        }),
      );

      expect(error).toMatchObject({
        _tag: 'ProductInfrastructureError',
        messageKey: 'products.importAreaLocationRequired',
      });
      expect(state.calls.createArea).toBe(0);
    }),
  );
});
