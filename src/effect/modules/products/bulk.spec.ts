import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { makeProductBulkWorkflows, type ProductBulkRepository } from './bulk';
import type { ProductWithRelations } from './types';

const now = new Date('2026-01-01T00:00:00.000Z');

const product = (
  overrides: Partial<ProductWithRelations> = {},
): ProductWithRelations => ({
  id: 'prod-1',
  tenant_id: '00000000-0000-4000-8000-000000000001',
  sku: 'SKU-001',
  name: 'Widget',
  description: null,
  category_id: '00000000-0000-4000-8000-000000000002',
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
  overrides: Partial<ProductBulkRepository> = {},
): ProductBulkRepository => ({
  findByIds: (ids) => Effect.succeed(ids.map((id) => ({ id }))),
  findDeletedByIds: (ids) => Effect.succeed(ids.map((id) => ({ id }))),
  updateMany: (ids) => Effect.succeed([...ids]),
  softDelete: () => Effect.void,
  hardDelete: () => Effect.void,
  softDeleteMany: (ids) => Effect.succeed([...ids]),
  hardDeleteMany: (ids) => Effect.succeed([...ids]),
  restore: () => Effect.void,
  restoreMany: (ids) => Effect.succeed([...ids]),
  ...overrides,
});

describe('makeProductBulkWorkflows', () => {
  it.effect('soft deletes existing products in bulk', () =>
    Effect.gen(function* () {
      let deletedIds: readonly string[] = [];
      const workflows = makeProductBulkWorkflows({
        repository: makeRepository({
          softDeleteMany: (ids) =>
            Effect.sync(() => {
              deletedIds = ids;
              return [...ids];
            }),
        }),
        getProductOrFail: () => Effect.succeed(product()),
      });

      const result = yield* workflows.bulkDelete({
        ids: ['prod-1'],
        permanent: false,
      });

      expect(deletedIds).toEqual(['prod-1']);
      expect(result.success_count).toBe(1);
    }),
  );

  it.effect('restores a deleted product and returns the response shape', () =>
    Effect.gen(function* () {
      let restoredId: string | undefined;
      const workflows = makeProductBulkWorkflows({
        repository: makeRepository({
          restore: (id) =>
            Effect.sync(() => {
              restoredId = id;
            }),
        }),
        getProductOrFail: (id, includeDeleted) =>
          Effect.succeed(
            product({
              id,
              deleted_at: includeDeleted
                ? new Date('2026-01-02T00:00:00.000Z')
                : null,
            }),
          ),
      });

      const result = yield* workflows.restore('prod-1');

      expect(restoredId).toBe('prod-1');
      expect(result).toMatchObject({ id: 'prod-1', sku: 'SKU-001' });
    }),
  );

  it.effect('fails restore when the product is not deleted', () =>
    Effect.gen(function* () {
      const workflows = makeProductBulkWorkflows({
        repository: makeRepository(),
        getProductOrFail: () => Effect.succeed(product({ deleted_at: null })),
      });

      const error = yield* Effect.flip(workflows.restore('prod-1'));

      expect(error).toMatchObject({
        _tag: 'ProductNotDeleted',
        productId: 'prod-1',
      });
    }),
  );
});
