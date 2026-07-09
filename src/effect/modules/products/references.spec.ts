import { Effect } from 'effect';
import { describe, expect, it } from '@effect/vitest';
import {
  validateProductReferences,
  type ProductReferenceLookup,
} from './references';

const lookup = ({
  categoryExists = true,
  supplierExists = true,
  categoryCalls = [],
  supplierCalls = [],
}: {
  readonly categoryExists?: boolean;
  readonly supplierExists?: boolean;
  readonly categoryCalls?: string[];
  readonly supplierCalls?: string[];
} = {}): ProductReferenceLookup<never, never, never, never> => ({
  categoryExists: (categoryId) => {
    categoryCalls.push(categoryId);
    return Effect.succeed(categoryExists);
  },
  supplierExists: (supplierId) => {
    supplierCalls.push(supplierId);
    return Effect.succeed(supplierExists);
  },
});

describe('validateProductReferences', () => {
  it.effect('succeeds when category and supplier references exist', () =>
    validateProductReferences({
      lookup: lookup(),
      dto: {
        category_id: 'category-1',
        primary_supplier_id: 'supplier-1',
      },
    }),
  );

  it.effect('fails with CategoryNotFound when the category is missing', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateProductReferences({
          lookup: lookup({ categoryExists: false }),
          dto: { category_id: 'missing-category' },
        }),
      );

      expect(error).toMatchObject({
        _tag: 'CategoryNotFound',
        categoryId: 'missing-category',
      });
    }),
  );

  it.effect('fails with SupplierNotFound when the supplier is missing', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateProductReferences({
          lookup: lookup({ supplierExists: false }),
          dto: { primary_supplier_id: 'missing-supplier' },
        }),
      );

      expect(error).toMatchObject({
        _tag: 'SupplierNotFound',
        id: 'missing-supplier',
      });
    }),
  );

  it.effect('skips lookups when references are omitted', () =>
    Effect.gen(function* () {
      const categoryCalls: string[] = [];
      const supplierCalls: string[] = [];

      yield* validateProductReferences({
        lookup: lookup({ categoryCalls, supplierCalls }),
        dto: {},
      });

      expect(categoryCalls).toEqual([]);
      expect(supplierCalls).toEqual([]);
    }),
  );
});
