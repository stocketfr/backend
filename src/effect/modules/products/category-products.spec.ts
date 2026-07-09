import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  makeProductCategoryWorkflows,
  type ProductCategoryRepository,
} from './category-products';
import type { ProductWithRelations } from './types';
import { CategoryNotFound } from '../categories/categories.errors';

const now = new Date('2026-01-01T00:00:00.000Z');

const product = (
  overrides: Partial<ProductWithRelations> = {},
): ProductWithRelations => ({
  id: 'prod-1',
  tenant_id: '00000000-0000-4000-8000-000000000001',
  sku: 'SKU-001',
  name: 'Widget',
  description: null,
  category_id: 'cat-1',
  volume_ml: null,
  weight_kg: null,
  dimensions_cm: null,
  standard_cost: 10,
  standard_price: 20,
  markup_percentage: null,
  reorder_point: 5,
  primary_supplier_id: null,
  supplier_sku: null,
  barcode: null,
  unit: null,
  is_active: true,
  is_perishable: false,
  notes: null,
  created_at: now,
  updated_at: now,
  deleted_at: null,
  created_by: null,
  updated_by: null,
  deleted_by: null,
  category: null,
  primary_supplier: null,
  ...overrides,
});

const makeRepository = (
  overrides: Partial<ProductCategoryRepository> = {},
): ProductCategoryRepository => ({
  findByCategoryId: () => Effect.succeed([product()]),
  findByCategoryIds: () => Effect.succeed([product()]),
  ...overrides,
});

describe('makeProductCategoryWorkflows', () => {
  it.effect('finds products in one category after validating it', () =>
    Effect.gen(function* () {
      const checked: string[] = [];
      const workflows = makeProductCategoryWorkflows({
        repository: makeRepository(),
        checkCategoryExists: (categoryId) =>
          Effect.sync(() => {
            checked.push(categoryId);
          }),
        findAllDescendantIds: () => Effect.succeed([]),
      });

      const result = yield* workflows.findByCategory('cat-1');

      expect(checked).toEqual(['cat-1']);
      expect(result).toMatchObject([{ id: 'prod-1', sku: 'SKU-001' }]);
    }),
  );

  it.effect('includes descendant categories for tree lookups', () =>
    Effect.gen(function* () {
      let queriedIds: readonly string[] = [];
      const workflows = makeProductCategoryWorkflows({
        repository: makeRepository({
          findByCategoryIds: (categoryIds) =>
            Effect.sync(() => {
              queriedIds = categoryIds;
              return [product()];
            }),
        }),
        checkCategoryExists: () => Effect.void,
        findAllDescendantIds: () => Effect.succeed(['cat-2']),
      });

      yield* workflows.findByCategoryTree('cat-1');

      expect(queriedIds).toEqual(['cat-1', 'cat-2']);
    }),
  );

  it.effect('propagates category validation failures before querying', () =>
    Effect.gen(function* () {
      let queried = false;
      const workflows = makeProductCategoryWorkflows({
        repository: makeRepository({
          findByCategoryId: () =>
            Effect.sync(() => {
              queried = true;
              return [product()];
            }),
        }),
        checkCategoryExists: () =>
          Effect.fail(
            new CategoryNotFound({
              id: 'missing',
              messageKey: 'categories.notFound',
            }),
          ),
        findAllDescendantIds: () => Effect.succeed([]),
      });

      const error = yield* Effect.flip(workflows.findByCategory('missing'));

      expect(error).toMatchObject({ _tag: 'CategoryNotFound' });
      expect(queried).toBe(false);
    }),
  );
});
