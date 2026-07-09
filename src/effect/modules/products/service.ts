import { Effect } from 'effect';
import { fromNullOr } from '../../platform/effect/from-null-or';
import {
  makeEnsureExistByIds,
  makeEnsureExistsById,
} from '../../platform/effect/existence';
import { toPaginatedResponse } from '@stocket/types/common';
import { CategoriesService } from '../categories/service';
import { SuppliersService } from '../suppliers/service';
import type {
  BulkCreateProductsDto,
  BulkDeleteDto,
  BulkRestoreDto,
  BulkUpdateStatusDto,
  CreateProductDto,
  ProductQueryDto,
  UpdateProductDto,
} from './types';
import { toProductResponseDto } from './mappers';
import { ProductNotFound } from './products.errors';
import { ProductsRepository } from './repository';
import { validateProductReferences } from './references';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { makeBulkCreateProducts } from './bulk-create';
import { mapSkuUniqueViolation, validatePriceNotBelowCost } from './validation';
import { makeProductWriteWorkflows } from './write';
import { makeProductBulkWorkflows } from './bulk';
import { makeProductCategoryWorkflows } from './category-products';

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
        fromNullOr(repository.findById(id, includeDeleted), () =>
          makeProductNotFound(id),
        );

      const productReferenceLookup = {
        categoryExists: categoriesService.existsById,
        supplierExists: suppliersService.existsById,
      };

      const validateProductTenantReferences = (
        dto: Pick<
          CreateProductDto | UpdateProductDto,
          'category_id' | 'primary_supplier_id'
        >,
      ) => validateProductReferences({ lookup: productReferenceLookup, dto });

      const checkCategoryExists = (categoryId: string) =>
        validateProductReferences({
          lookup: productReferenceLookup,
          dto: { category_id: categoryId },
        });

      const productWriteWorkflows = makeProductWriteWorkflows({
        repository,
        validateProductTenantReferences,
        getProductOrFail,
      });
      const productBulkWorkflows = makeProductBulkWorkflows({
        repository,
        getProductOrFail,
      });
      const productCategoryWorkflows = makeProductCategoryWorkflows({
        repository,
        checkCategoryExists,
        findAllDescendantIds: categoriesService.findAllDescendantIds,
      });

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
        productCategoryWorkflows.findByCategory(categoryId).pipe(
          trace.span('findByCategory', {
            attributes: { categoryId },
          }),
        );

      const findByCategoryTree = (categoryId: string) =>
        productCategoryWorkflows.findByCategoryTree(categoryId).pipe(
          trace.span('findByCategoryTree', {
            attributes: { categoryId },
          }),
        );

      const create = (dto: CreateProductDto, userId?: string) =>
        productWriteWorkflows.create(dto, userId).pipe(trace.span('create'));

      const bulkCreateWorkflow = makeBulkCreateProducts({
        repository,
        categoriesService,
        suppliersService,
        validatePriceNotBelowCost,
        mapSkuUniqueViolation,
      });
      const bulkCreate = (bulkDto: BulkCreateProductsDto, userId?: string) =>
        bulkCreateWorkflow(bulkDto, userId).pipe(trace.span('bulkCreate'));

      const update = (id: string, dto: UpdateProductDto, userId?: string) =>
        productWriteWorkflows
          .update(id, dto, userId)
          .pipe(trace.span('update', { attributes: { id } }));

      const bulkUpdateStatus = (
        bulkDto: BulkUpdateStatusDto,
        userId?: string,
      ) =>
        productBulkWorkflows
          .bulkUpdateStatus(bulkDto, userId)
          .pipe(trace.span('bulkUpdateStatus'));

      const remove = (id: string, userId?: string, permanent = false) =>
        productBulkWorkflows
          .delete(id, userId, permanent)
          .pipe(trace.span('delete', { attributes: { id } }));

      const bulkDelete = (bulkDto: BulkDeleteDto, userId?: string) =>
        productBulkWorkflows
          .bulkDelete(bulkDto, userId)
          .pipe(trace.span('bulkDelete'));

      const restore = (id: string) =>
        productBulkWorkflows
          .restore(id)
          .pipe(trace.span('restore', { attributes: { id } }));

      const bulkRestore = (bulkDto: BulkRestoreDto) =>
        productBulkWorkflows
          .bulkRestore(bulkDto)
          .pipe(trace.span('bulkRestore'));

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
