import { Effect } from 'effect';
import { fromNullOr } from '../../platform/effect/from-null-or';
import {
  hasDefinedPatchValues,
  pickDefined,
} from '../../platform/effect/pick-defined';
import type { ProductsRepository } from './repository';
import type { ProductReferenceInput } from './references';
import type { CreateProductDto, UpdateProductDto } from './types';
import { toProductResponseDto } from './mappers';
import { toCreateProductEntity } from './products.utils';
import { ProductsInfrastructureError } from './products.errors';
import {
  ensureSkuAvailable,
  mapSkuUniqueViolation,
  validatePriceNotBelowCost,
} from './validation';

export type ProductWriteRepository = Pick<
  ProductsRepository,
  'create' | 'findById' | 'findBySku' | 'update'
>;

type ProductWithRelations = NonNullable<
  Effect.Effect.Success<ReturnType<ProductsRepository['findById']>>
>;

interface ProductWriteWorkflowOptions<
  ReferenceError,
  ReferenceContext,
  GetProductError,
  GetProductContext,
> {
  readonly repository: ProductWriteRepository;
  readonly validateProductTenantReferences: (
    dto: ProductReferenceInput,
  ) => Effect.Effect<void, ReferenceError, ReferenceContext>;
  readonly getProductOrFail: (
    id: string,
  ) => Effect.Effect<ProductWithRelations, GetProductError, GetProductContext>;
}

export const makeProductWriteWorkflows = <
  ReferenceError,
  ReferenceContext,
  GetProductError,
  GetProductContext,
>({
  repository,
  validateProductTenantReferences,
  getProductOrFail,
}: ProductWriteWorkflowOptions<
  ReferenceError,
  ReferenceContext,
  GetProductError,
  GetProductContext
>) => {
  const create = (dto: CreateProductDto, userId?: string) =>
    Effect.gen(function* () {
      yield* validateProductTenantReferences(dto);
      yield* ensureSkuAvailable(repository, dto.sku);
      yield* validatePriceNotBelowCost(dto.standard_price, dto.standard_cost);

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
    });

  const update = (id: string, dto: UpdateProductDto, userId?: string) =>
    Effect.gen(function* () {
      const product = yield* getProductOrFail(id);

      yield* validateProductTenantReferences(dto);

      if (dto.sku && dto.sku !== product.sku) {
        yield* ensureSkuAvailable(repository, dto.sku);
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
        .pipe(Effect.mapError(mapSkuUniqueViolation(dto.sku ?? product.sku)));

      const updated = yield* getProductOrFail(id);
      return toProductResponseDto(updated);
    });

  return { create, update };
};
