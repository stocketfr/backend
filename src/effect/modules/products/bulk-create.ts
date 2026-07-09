import { Effect } from 'effect';
import { createBulkResultBuilder, findDuplicates } from '@stocket/types/common';
import type { CategoriesService } from '../categories/service';
import type { SuppliersService } from '../suppliers/service';
import { toCreateProductEntity } from './products.utils';
import type { ProductsRepository } from './repository';
import type { BulkCreateProductsDto } from './types';
import type { PriceBelowCost, SkuAlreadyExists } from './products.errors';

interface BulkCreateDependencies {
  readonly repository: typeof ProductsRepository.Service;
  readonly categoriesService: typeof CategoriesService.Service;
  readonly suppliersService: typeof SuppliersService.Service;
  readonly validatePriceNotBelowCost: (
    standardPrice: number | null | undefined,
    standardCost: number | null | undefined,
  ) => Effect.Effect<void, PriceBelowCost>;
  readonly mapSkuUniqueViolation: <E>(
    sku: string,
  ) => (error: E) => E | SkuAlreadyExists;
}

export const makeBulkCreateProducts = ({
  repository,
  categoriesService,
  suppliersService,
  validatePriceNotBelowCost,
  mapSkuUniqueViolation,
}: BulkCreateDependencies) =>
  (bulkDto: BulkCreateProductsDto, userId?: string) =>
    Effect.gen(function* () {
      const result = createBulkResultBuilder();

      const categoryIds = [
        ...new Set(bulkDto.products.map((p) => p.category_id)),
      ];
      const missingCategoryId = yield* categoriesService
        .ensureExistByIds(categoryIds)
        .pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              error._tag === 'CategoryNotFound'
                ? Effect.succeed(error.id)
                : Effect.fail(error),
            onSuccess: () => Effect.succeed(null),
          }),
        );
      if (missingCategoryId) {
        for (const product of bulkDto.products) {
          if (product.category_id === missingCategoryId) {
            result.addFailure(`Category ${missingCategoryId} not found`, {
              sku: product.sku,
            });
          }
        }
        return result.build();
      }

      const supplierIds = [
        ...new Set(
          bulkDto.products
            .map((p) => p.primary_supplier_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const missingSupplierId = yield* suppliersService
        .ensureExistByIds(supplierIds)
        .pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              error._tag === 'SupplierNotFound'
                ? Effect.succeed(error.id)
                : Effect.fail(error),
            onSuccess: () => Effect.succeed(null),
          }),
        );
      if (missingSupplierId) {
        for (const product of bulkDto.products) {
          if (product.primary_supplier_id === missingSupplierId) {
            result.addFailure(`Supplier ${missingSupplierId} not found`, {
              sku: product.sku,
            });
          }
        }
        return result.build();
      }

      const skusInRequest = bulkDto.products.map((p) => p.sku);
      const duplicateSkus = findDuplicates(skusInRequest);

      if (duplicateSkus.length > 0) {
        for (const product of bulkDto.products) {
          if (duplicateSkus.includes(product.sku)) {
            result.addFailure('Duplicate SKU in request', {
              sku: product.sku,
            });
          }
        }
      }

      const existingSkus = new Set(
        (yield* repository.findBySkus(skusInRequest, true)).map(
          (product) => product.sku,
        ),
      );

      for (const productDto of bulkDto.products) {
        if (duplicateSkus.includes(productDto.sku)) continue;

        const priceError = yield* validatePriceNotBelowCost(
          productDto.standard_price,
          productDto.standard_cost,
        ).pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => null,
          }),
        );
        if (priceError) {
          result.addFailure(priceError.message, {
            sku: productDto.sku,
          });
          continue;
        }

        if (existingSkus.has(productDto.sku)) {
          result.addFailure('A product with this SKU already exists', {
            sku: productDto.sku,
          });
          continue;
        }

        const entityData = toCreateProductEntity(productDto, userId);
        const product = yield* repository.create(entityData).pipe(
          Effect.mapError(mapSkuUniqueViolation(productDto.sku)),
          Effect.matchEffect({
            onFailure: (error) =>
              error._tag === 'SkuAlreadyExists'
                ? Effect.sync(() => {
                    result.addFailure(error.message, {
                      sku: productDto.sku,
                    });
                    return null;
                  })
                : Effect.fail(error),
            onSuccess: (created) => Effect.succeed(created),
          }),
        );
        if (product) {
          result.addSuccess(product.id);
        }
      }

      return result.build();
    });
