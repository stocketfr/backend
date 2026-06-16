import { Effect } from 'effect';
import type { Schema } from 'effect';
import { fromNullOr } from '../../platform/effect/from-null-or';
import {
  createBulkResultBuilder,
  findDuplicates,
  partitionByExistence,
  toPaginatedResponse,
} from '@stocket/types/common';
import { CategoriesService } from '../categories/service';
import { SuppliersService } from '../suppliers/service';
import { SupplierNotFound } from '../suppliers/suppliers.errors';
import type {
  ProductQuerySchema,
  CreateProductRequestSchema,
  UpdateProductRequestSchema,
  BulkCreateProductsSchema,
  BulkUpdateStatusSchema,
  BulkDeleteSchema,
  BulkRestoreSchema,
} from '@stocket/types/products';
import { toCreateProductEntity, toProductResponseDto } from './products.utils';
import {
  CategoryNotFound,
  PriceBelowCost,
  ProductNotDeleted,
  ProductNotFound,
  ProductsInfrastructureError,
  SkuAlreadyExists,
} from './products.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { ProductsRepository } from './repository';

type ProductQueryDto = Schema.Schema.Type<typeof ProductQuerySchema>;
type CreateProductDto = Schema.Schema.Type<typeof CreateProductRequestSchema>;
type UpdateProductDto = Schema.Schema.Type<typeof UpdateProductRequestSchema>;
type BulkCreateProductsDto = Schema.Schema.Type<
  typeof BulkCreateProductsSchema
>;
type BulkUpdateStatusDto = Schema.Schema.Type<typeof BulkUpdateStatusSchema>;
type BulkDeleteDto = Schema.Schema.Type<typeof BulkDeleteSchema>;
type BulkRestoreDto = Schema.Schema.Type<typeof BulkRestoreSchema>;

export class ProductsService extends Effect.Service<ProductsService>()(
  '@stocket/effect/products/ProductsService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* ProductsRepository;
      const categoriesService = yield* CategoriesService;
      const suppliersService = yield* SuppliersService;

      const getProductOrFail = (id: string, includeDeleted = false) =>
        fromNullOr(
          repository.findById(id, includeDeleted),
          () =>
            new ProductNotFound({
              productId: id,
              messageKey: 'products.notFound',
            }),
        );

      const checkCategoryExists = (categoryId: string) =>
        categoriesService.existsById(categoryId).pipe(
          Effect.filterOrFail(
            Boolean,
            () =>
              new CategoryNotFound({
                categoryId,
                messageKey: 'products.categoryNotFound',
              }),
          ),
          Effect.asVoid,
        );

      const checkSupplierExists = (supplierId: string) =>
        suppliersService.existsById(supplierId).pipe(
          Effect.filterOrFail(
            Boolean,
            () =>
              new SupplierNotFound({
                id: supplierId,
                messageKey: 'suppliers.notFound',
              }),
          ),
          Effect.asVoid,
        );

      const validateProductTenantReferences = (
        dto: Pick<
          CreateProductDto | UpdateProductDto,
          'category_id' | 'primary_supplier_id'
        >,
      ) =>
        Effect.gen(function* () {
          if (dto.category_id) {
            yield* checkCategoryExists(dto.category_id);
          }

          if (dto.primary_supplier_id) {
            yield* checkSupplierExists(dto.primary_supplier_id);
          }
        });

      const ensureSkuAvailable = (
        sku: string,
      ): Effect.Effect<
        void,
        ProductsInfrastructureError | SkuAlreadyExists | TenantNotResolved
      > =>
        repository.findBySku(sku).pipe(
          Effect.filterOrFail(
            (existing) => existing === null,
            () =>
              new SkuAlreadyExists({
                sku,
                messageKey: 'products.skuAlreadyExists',
              }),
          ),
          Effect.asVoid,
        );

      const validatePriceNotBelowCost = (
        standardPrice: number | null | undefined,
        standardCost: number | null | undefined,
      ): Effect.Effect<void, PriceBelowCost> => {
        if (
          standardPrice != null &&
          standardCost != null &&
          standardPrice < standardCost
        ) {
          return Effect.fail(
            new PriceBelowCost({
              standardPrice,
              standardCost,
              messageKey: 'products.priceBelowCost',
            }),
          );
        }
        return Effect.void;
      };

      const findAllPaginated = (query: ProductQueryDto) =>
        Effect.map(repository.findAllPaginated(query), (result) =>
          toPaginatedResponse(result, toProductResponseDto),
        ).pipe(Effect.withSpan('ProductsService.findAllPaginated'));

      const findAll = () =>
        Effect.map(repository.findAll(), (products) =>
          products.map(toProductResponseDto),
        ).pipe(Effect.withSpan('ProductsService.findAll'));

      const findOne = (id: string, includeDeleted = false) =>
        Effect.map(
          getProductOrFail(id, includeDeleted),
          toProductResponseDto,
        ).pipe(
          Effect.withSpan('ProductsService.findOne', { attributes: { id } }),
        );

      const findByCategory = (categoryId: string) =>
        Effect.gen(function* () {
          yield* checkCategoryExists(categoryId);
          const products = yield* repository.findByCategoryId(categoryId);
          return products.map(toProductResponseDto);
        }).pipe(
          Effect.withSpan('ProductsService.findByCategory', {
            attributes: { categoryId },
          }),
        );

      const findByCategoryTree = (categoryId: string) =>
        Effect.gen(function* () {
          yield* checkCategoryExists(categoryId);
          const descendantIds =
            yield* categoriesService.findAllDescendantIds(categoryId);
          const categoryIds = [categoryId, ...descendantIds];
          const products = yield* repository.findByCategoryIds(categoryIds);
          return products.map(toProductResponseDto);
        }).pipe(
          Effect.withSpan('ProductsService.findByCategoryTree', {
            attributes: { categoryId },
          }),
        );

      const create = (dto: CreateProductDto, userId?: string) =>
        Effect.gen(function* () {
          yield* validateProductTenantReferences(dto);
          yield* ensureSkuAvailable(dto.sku);
          yield* validatePriceNotBelowCost(
            dto.standard_price,
            dto.standard_cost,
          );

          const entityData = toCreateProductEntity(dto, userId);
          const product = yield* repository.create(entityData);
          const productWithRelations = yield* Effect.flatMap(
            repository.findById(product.id),
            (p) =>
              p
                ? Effect.succeed(p)
                : Effect.fail(
                    new ProductsInfrastructureError({
                      action: 'load created product',
                      messageKey: 'products.createdProductLoadFailed',
                    }),
                  ),
          );
          return toProductResponseDto(productWithRelations);
        }).pipe(Effect.withSpan('ProductsService.create'));

      const bulkCreate = (bulkDto: BulkCreateProductsDto, userId?: string) =>
        Effect.gen(function* () {
          const result = createBulkResultBuilder();

          const categoryIds = [
            ...new Set(bulkDto.products.map((p) => p.category_id)),
          ];
          for (const categoryId of categoryIds) {
            const exists = yield* categoriesService.existsById(categoryId);
            if (!exists) {
              for (const product of bulkDto.products) {
                if (product.category_id === categoryId) {
                  result.addFailure(`Category ${categoryId} not found`, {
                    sku: product.sku,
                  });
                }
              }
              return result.build();
            }
          }

          const supplierIds = [
            ...new Set(
              bulkDto.products
                .map((p) => p.primary_supplier_id)
                .filter((id): id is string => Boolean(id)),
            ),
          ];
          for (const supplierId of supplierIds) {
            const exists = yield* suppliersService.existsById(supplierId);
            if (!exists) {
              for (const product of bulkDto.products) {
                if (product.primary_supplier_id === supplierId) {
                  result.addFailure(`Supplier ${supplierId} not found`, {
                    sku: product.sku,
                  });
                }
              }
              return result.build();
            }
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

          for (const productDto of bulkDto.products) {
            if (duplicateSkus.includes(productDto.sku)) continue;

            const existingSku = yield* repository.findBySku(productDto.sku);
            if (existingSku) {
              result.addFailure('A product with this SKU already exists', {
                sku: productDto.sku,
              });
              continue;
            }

            const entityData = toCreateProductEntity(productDto, userId);
            const product = yield* repository.create(entityData);
            result.addSuccess(product.id);
          }

          return result.build();
        }).pipe(Effect.withSpan('ProductsService.bulkCreate'));

      const update = (id: string, dto: UpdateProductDto, userId?: string) =>
        Effect.gen(function* () {
          const product = yield* getProductOrFail(id);

          yield* validateProductTenantReferences(dto);

          if (dto.sku && dto.sku !== product.sku) {
            yield* ensureSkuAvailable(dto.sku);
          }

          yield* validatePriceNotBelowCost(
            dto.standard_price ?? product.standard_price,
            dto.standard_cost ?? product.standard_cost,
          );

          if (Object.keys(dto).length === 0) {
            return toProductResponseDto(product);
          }

          yield* repository.update(id, { ...dto, updated_by: userId ?? null });

          const updated = yield* getProductOrFail(id);
          return toProductResponseDto(updated);
        }).pipe(
          Effect.withSpan('ProductsService.update', { attributes: { id } }),
        );

      const bulkUpdateStatus = (
        bulkDto: BulkUpdateStatusDto,
        userId?: string,
      ) =>
        Effect.gen(function* () {
          const result = createBulkResultBuilder();

          const ids = [...bulkDto.ids];
          const existingProducts = yield* repository.findByIds(ids);
          const existingIds = new Set(existingProducts.map((p) => p.id));
          const { existing: idsToUpdate, notFound } = partitionByExistence(
            ids,
            existingIds,
          );

          result.addNotFoundFailures(notFound, 'Product');

          if (idsToUpdate.length > 0) {
            const affectedCount = yield* repository.updateMany(idsToUpdate, {
              is_active: bulkDto.is_active,
              updated_by: userId ?? null,
            });
            return result.buildWith({
              success_count: affectedCount,
              succeeded: idsToUpdate.slice(0, affectedCount),
            });
          }

          return result.build();
        }).pipe(Effect.withSpan('ProductsService.bulkUpdateStatus'));

      const remove = (id: string, userId?: string, permanent = false) =>
        Effect.gen(function* () {
          yield* getProductOrFail(id);
          if (permanent) {
            yield* repository.hardDelete(id);
          } else {
            yield* repository.softDelete(id, userId);
          }
        }).pipe(
          Effect.withSpan('ProductsService.delete', { attributes: { id } }),
        );

      const bulkDelete = (bulkDto: BulkDeleteDto, userId?: string) =>
        Effect.gen(function* () {
          const result = createBulkResultBuilder();

          const ids = [...bulkDto.ids];
          const existingProducts = yield* repository.findByIds(ids);
          const existingIds = new Set(existingProducts.map((p) => p.id));
          const { existing: idsToDelete, notFound } = partitionByExistence(
            ids,
            existingIds,
          );

          result.addNotFoundFailures(notFound, 'Product');

          if (idsToDelete.length > 0) {
            const affectedCount = bulkDto.permanent
              ? yield* repository.hardDeleteMany(idsToDelete)
              : yield* repository.softDeleteMany(idsToDelete, userId);
            return result.buildWith({
              success_count: affectedCount,
              succeeded: idsToDelete.slice(0, affectedCount),
            });
          }

          return result.build();
        }).pipe(Effect.withSpan('ProductsService.bulkDelete'));

      const restore = (id: string) =>
        Effect.gen(function* () {
          const product = yield* getProductOrFail(id, true);
          if (!product.deleted_at) {
            return yield* Effect.fail(
              new ProductNotDeleted({
                productId: id,
                messageKey: 'products.notDeleted',
              }),
            );
          }

          yield* repository.restore(id);

          const restored = yield* getProductOrFail(id);
          return toProductResponseDto(restored);
        }).pipe(
          Effect.withSpan('ProductsService.restore', { attributes: { id } }),
        );

      const bulkRestore = (bulkDto: BulkRestoreDto) =>
        Effect.gen(function* () {
          const result = createBulkResultBuilder();

          const ids = [...bulkDto.ids];
          const deletedProducts = yield* repository.findDeletedByIds(ids);
          const deletedIds = new Set(deletedProducts.map((p) => p.id));
          const { existing: idsToRestore, notFound } = partitionByExistence(
            ids,
            deletedIds,
          );

          for (const id of notFound) {
            result.addFailure('Product not found or not deleted', { id });
          }

          if (idsToRestore.length > 0) {
            const affectedCount = yield* repository.restoreMany(idsToRestore);
            return result.buildWith({
              success_count: affectedCount,
              succeeded: idsToRestore.slice(0, affectedCount),
            });
          }

          return result.build();
        }).pipe(Effect.withSpan('ProductsService.bulkRestore'));

      const existsById = (id: string) =>
        repository
          .existsById(id)
          .pipe(
            Effect.withSpan('ProductsService.existsById', {
              attributes: { id },
            }),
          );

      return {
        findAllPaginated,
        findAll,
        findOne,
        findByCategory,
        findByCategoryTree,
        create,
        bulkCreate,
        update,
        bulkUpdateStatus,
        delete: remove,
        bulkDelete,
        restore,
        bulkRestore,
        existsById,
      };
    }),
    dependencies: [
      ProductsRepository.Default,
      CategoriesService.Default,
      SuppliersService.Default,
    ],
  },
) {}
