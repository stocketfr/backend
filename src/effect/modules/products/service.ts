import { Effect } from 'effect';
import type { Schema } from 'effect';
import { fromNullOr } from '../../platform/effect/from-null-or';
import {
  hasDefinedPatchValues,
  pickDefined,
} from '../../platform/effect/pick-defined';
import {
  makeEnsureExistByIds,
  makeEnsureExistsById,
} from '../../platform/effect/existence';
import {
  createBulkResultBuilder,
  findDuplicates,
  toPaginatedResponse,
} from '@stocket/types/common';
import { runBulkByIds } from '../../platform/effect/run-bulk-by-ids';
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
import { pgUniqueViolationConstraintName } from '../../platform/db/pg-errors';
import { makeServiceTracer } from '../../platform/observability/service-tracer';

type ProductQueryDto = Schema.Schema.Type<typeof ProductQuerySchema>;
type CreateProductDto = Schema.Schema.Type<typeof CreateProductRequestSchema>;
type UpdateProductDto = Schema.Schema.Type<typeof UpdateProductRequestSchema>;
type BulkCreateProductsDto = Schema.Schema.Type<
  typeof BulkCreateProductsSchema
>;
type BulkUpdateStatusDto = Schema.Schema.Type<typeof BulkUpdateStatusSchema>;
type BulkDeleteDto = Schema.Schema.Type<typeof BulkDeleteSchema>;
type BulkRestoreDto = Schema.Schema.Type<typeof BulkRestoreSchema>;

const PRODUCT_SKU_UNIQUE_CONSTRAINT = 'products_tenant_sku_unique';

export class ProductsService extends Effect.Service<ProductsService>()(
  '@stocket/effect/products/ProductsService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* ProductsRepository;
      const categoriesService = yield* CategoriesService;
      const suppliersService = yield* SuppliersService;
      const trace = makeServiceTracer({
        serviceName: 'ProductsService',
        module: 'products',
        layer: 'service',
      });

      const makeProductNotFound = (id: string) =>
        new ProductNotFound({
          productId: id,
          messageKey: 'products.notFound',
        });

      const getProductOrFail = (id: string, includeDeleted = false) =>
        fromNullOr(
          repository.findById(id, includeDeleted),
          () => makeProductNotFound(id),
        );

      const checkCategoryExists = makeEnsureExistsById(
        categoriesService.existsById,
        (categoryId) =>
          new CategoryNotFound({
            categoryId,
            messageKey: 'products.categoryNotFound',
          }),
        );

      const checkSupplierExists = makeEnsureExistsById(
        suppliersService.existsById,
        (supplierId) =>
          new SupplierNotFound({
            id: supplierId,
            messageKey: 'suppliers.notFound',
          }),
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
        repository.findBySku(sku, true).pipe(
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

      const skuAlreadyExists = (sku: string) =>
        new SkuAlreadyExists({
          sku,
          messageKey: 'products.skuAlreadyExists',
        });

      const mapSkuUniqueViolation =
        <E>(sku: string) =>
        (error: E): E | SkuAlreadyExists =>
          pgUniqueViolationConstraintName(error) ===
          PRODUCT_SKU_UNIQUE_CONSTRAINT
            ? skuAlreadyExists(sku)
            : error;

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
        ).pipe(trace.span('findAllPaginated'));

      const findAll = () =>
        Effect.map(repository.findAll(), (products) =>
          products.map(toProductResponseDto),
        ).pipe(trace.span('findAll'));

      const findOne = (id: string, includeDeleted = false) =>
        Effect.map(
          getProductOrFail(id, includeDeleted),
          toProductResponseDto,
        ).pipe(trace.span('findOne', { attributes: { id } }));

      const findByCategory = (categoryId: string) =>
        Effect.gen(function* () {
          yield* checkCategoryExists(categoryId);
          const products = yield* repository.findByCategoryId(categoryId);
          return products.map(toProductResponseDto);
        }).pipe(
          trace.span('findByCategory', {
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
          trace.span('findByCategoryTree', {
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
          const product = yield* repository
            .create(entityData)
            .pipe(Effect.mapError(mapSkuUniqueViolation(dto.sku)));
          const productWithRelations = yield* fromNullOr(
            repository.findById(product.id),
            () =>
              new ProductsInfrastructureError({
                action: 'load created product',
                messageKey: 'products.createdProductLoadFailed',
              }),
          );
          return toProductResponseDto(productWithRelations);
        }).pipe(trace.span('create'));

      const bulkCreate = (bulkDto: BulkCreateProductsDto, userId?: string) =>
        Effect.gen(function* () {
          const result = createBulkResultBuilder();

          const categoryIds = [
            ...new Set(bulkDto.products.map((p) => p.category_id)),
          ];
          const missingCategoryId =
            yield* categoriesService.ensureExistByIds(categoryIds).pipe(
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
          const missingSupplierId =
            yield* suppliersService.ensureExistByIds(supplierIds).pipe(
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
        }).pipe(trace.span('bulkCreate'));

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

          const updateData = pickDefined<UpdateProductDto>([
            ['sku', dto.sku],
            ['name', dto.name],
            ['description', dto.description],
            ['category_id', dto.category_id],
            ['volume_ml', dto.volume_ml],
            ['weight_kg', dto.weight_kg],
            ['dimensions_cm', dto.dimensions_cm],
            ['standard_cost', dto.standard_cost],
            ['standard_price', dto.standard_price],
            ['markup_percentage', dto.markup_percentage],
            ['reorder_point', dto.reorder_point],
            ['primary_supplier_id', dto.primary_supplier_id],
            ['supplier_sku', dto.supplier_sku],
            ['barcode', dto.barcode],
            ['unit', dto.unit],
            ['is_active', dto.is_active],
            ['is_perishable', dto.is_perishable],
            ['notes', dto.notes],
          ]);

          if (!hasDefinedPatchValues(updateData)) {
            return toProductResponseDto(product);
          }

          yield* repository
            .update(id, { ...updateData, updated_by: userId ?? null })
            .pipe(
              Effect.mapError(mapSkuUniqueViolation(dto.sku ?? product.sku)),
            );

          const updated = yield* getProductOrFail(id);
          return toProductResponseDto(updated);
        }).pipe(trace.span('update', { attributes: { id } }));

      const bulkUpdateStatus = (
        bulkDto: BulkUpdateStatusDto,
        userId?: string,
      ) =>
        runBulkByIds({
          ids: bulkDto.ids,
          find: repository.findByIds,
          act: (idsToUpdate) =>
            repository.updateMany(idsToUpdate, {
              is_active: bulkDto.is_active,
              updated_by: userId ?? null,
            }),
          entityName: 'Product',
        }).pipe(trace.span('bulkUpdateStatus'));

      const remove = (id: string, userId?: string, permanent = false) =>
        Effect.gen(function* () {
          yield* getProductOrFail(id);
          if (permanent) {
            yield* repository.hardDelete(id);
          } else {
            yield* repository.softDelete(id, userId);
          }
        }).pipe(trace.span('delete', { attributes: { id } }));

      const bulkDelete = (bulkDto: BulkDeleteDto, userId?: string) =>
        runBulkByIds({
          ids: bulkDto.ids,
          find: repository.findByIds,
          act: (idsToDelete) =>
            bulkDto.permanent
              ? repository.hardDeleteMany(idsToDelete)
              : repository.softDeleteMany(idsToDelete, userId),
          entityName: 'Product',
        }).pipe(trace.span('bulkDelete'));

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
        }).pipe(trace.span('restore', { attributes: { id } }));

      const bulkRestore = (bulkDto: BulkRestoreDto) =>
        runBulkByIds({
          ids: bulkDto.ids,
          find: repository.findDeletedByIds,
          act: repository.restoreMany,
          notFoundError: 'Product not found or not deleted',
        }).pipe(trace.span('bulkRestore'));

      const existsById = (id: string) =>
        repository.existsById(id).pipe(
          trace.span('existsById', {
            attributes: { id },
          }),
        );

      const ensureExistsById = (id: string) =>
        makeEnsureExistsById(
          repository.existsById,
          makeProductNotFound,
        )(id).pipe(
          trace.span('ensureExistsById', {
            attributes: { id },
          }),
        );

      const ensureExistByIds = (ids: readonly string[]) =>
        makeEnsureExistByIds(
          (productIds: readonly string[]) =>
            repository.findByIds([...productIds]),
          makeProductNotFound,
        )(ids).pipe(trace.span('ensureExistByIds'));

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
        ensureExistsById,
        ensureExistByIds,
      };
    }),
    dependencies: [
      ProductsRepository.Default,
      CategoriesService.Default,
      SuppliersService.Default,
    ],
  },
) {}
