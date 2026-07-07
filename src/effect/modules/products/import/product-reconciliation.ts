import { Effect } from 'effect';
import { ProductsInfrastructureError } from '../products.errors';
import type { ProductImportRepository } from './repository';
import type {
  ImportCaches,
  NormalizedProductImportRow,
  ProductImportResultDto,
  ProductImportValues,
} from './types';
import {
  nullableText,
  parseBoolean,
  parseInteger,
  parseProductImportNumber,
  productValuesMatch,
} from './utils';

const makeProductValues = (
  row: NormalizedProductImportRow,
  categoryId: string,
  expiryDate: Date | null,
): ProductImportValues => ({
  name: row.name,
  description: nullableText(row.description),
  category_id: categoryId,
  unit: nullableText(row.unit),
  barcode: nullableText(row.barcode),
  standard_price: parseProductImportNumber(row.standard_price),
  reorder_point: parseInteger(row.reorder_point, 0),
  is_active: parseBoolean(row.is_active, true),
  is_perishable: parseBoolean(row.is_perishable, Boolean(expiryDate)),
  notes: nullableText(row.notes),
});

export const upsertImportProduct = (
  repository: ProductImportRepository,
  row: NormalizedProductImportRow,
  categoryId: string,
  caches: ImportCaches,
  result: ProductImportResultDto,
  expiryDate: Date | null,
  userId: string,
) =>
  Effect.gen(function* () {
    const cached = caches.products.get(row.sku);
    if (cached) return cached;

    const values = makeProductValues(row, categoryId, expiryDate);
    const existing = yield* repository.findProductBySku(row.sku);

    if (!existing) {
      const product = yield* repository.createProduct({
        sku: row.sku,
        ...values,
        created_by: userId,
        updated_by: userId,
      });
      result.productsCreated++;
      caches.products.set(row.sku, product);
      return product;
    }

    if (productValuesMatch(existing, values)) {
      caches.products.set(row.sku, existing);
      return existing;
    }

    const product = yield* repository.updateProduct(existing.id, {
      ...values,
      updated_by: userId,
    });
    if (!product) {
      return yield* Effect.fail(
        new ProductsInfrastructureError({
          action: 'update import product',
          messageKey: 'products.repositoryFailed',
        }),
      );
    }

    result.productsUpdated++;
    caches.products.set(row.sku, product);
    return product;
  });
