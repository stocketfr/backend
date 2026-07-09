import { Effect } from 'effect';
import { describe, expect, it } from '@effect/vitest';
import {
  ensureSkuAvailable,
  mapSkuUniqueViolation,
  validatePriceNotBelowCost,
  type ProductSkuLookup,
} from './validation';

const skuLookup = (value: unknown | null): ProductSkuLookup => ({
  findBySku: () => Effect.succeed(value),
});

describe('validatePriceNotBelowCost', () => {
  it.effect('allows missing prices and prices equal to or above cost', () =>
    Effect.gen(function* () {
      yield* validatePriceNotBelowCost(undefined, 10);
      yield* validatePriceNotBelowCost(10, null);
      yield* validatePriceNotBelowCost(10, 10);
      yield* validatePriceNotBelowCost(12, 10);
    }),
  );

  it.effect('fails when standard price is below standard cost', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(validatePriceNotBelowCost(8, 10));

      expect(error).toMatchObject({
        _tag: 'PriceBelowCost',
        standardPrice: 8,
        standardCost: 10,
      });
    }),
  );
});

describe('ensureSkuAvailable', () => {
  it.effect('succeeds when no existing product uses the SKU', () =>
    ensureSkuAvailable(skuLookup(null), 'SKU-1'),
  );

  it.effect('fails when an existing product already uses the SKU', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ensureSkuAvailable(skuLookup({ id: 'product-1' }), 'SKU-1'),
      );

      expect(error).toMatchObject({
        _tag: 'SkuAlreadyExists',
        sku: 'SKU-1',
      });
    }),
  );
});

describe('mapSkuUniqueViolation', () => {
  it('maps the product SKU unique constraint to SkuAlreadyExists', () => {
    const error = mapSkuUniqueViolation('SKU-1')({
      code: '23505',
      constraint: 'products_tenant_sku_unique',
    });

    expect(error).toMatchObject({
      _tag: 'SkuAlreadyExists',
      sku: 'SKU-1',
    });
  });

  it('preserves unrelated errors', () => {
    const original = { code: '23505', constraint: 'other_unique' };

    expect(mapSkuUniqueViolation('SKU-1')(original)).toBe(original);
  });
});
