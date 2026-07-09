import { Effect } from 'effect';
import { makeEnsureExistsById } from '../../platform/effect/existence';
import { SupplierNotFound } from '../suppliers/suppliers.errors';
import { CategoryNotFound } from './products.errors';
import type { CreateProductDto, UpdateProductDto } from './types';

export type ProductReferenceInput = Pick<
  CreateProductDto | UpdateProductDto,
  'category_id' | 'primary_supplier_id'
>;

export interface ProductReferenceLookup<
  CategoryError,
  CategoryContext,
  SupplierError,
  SupplierContext,
> {
  readonly categoryExists: (
    categoryId: string,
  ) => Effect.Effect<boolean, CategoryError, CategoryContext>;
  readonly supplierExists: (
    supplierId: string,
  ) => Effect.Effect<boolean, SupplierError, SupplierContext>;
}

export const validateProductReferences = <
  CategoryError,
  CategoryContext,
  SupplierError,
  SupplierContext,
>({
  lookup,
  dto,
}: {
  readonly lookup: ProductReferenceLookup<
    CategoryError,
    CategoryContext,
    SupplierError,
    SupplierContext
  >;
  readonly dto: ProductReferenceInput;
}) => {
  const checkCategoryExists = makeEnsureExistsById(
    lookup.categoryExists,
    (categoryId) =>
      new CategoryNotFound({
        categoryId,
        messageKey: 'products.categoryNotFound',
      }),
  );
  const checkSupplierExists = makeEnsureExistsById(
    lookup.supplierExists,
    (supplierId) =>
      new SupplierNotFound({
        id: supplierId,
        messageKey: 'suppliers.notFound',
      }),
  );

  return Effect.gen(function* () {
    if (dto.category_id) {
      yield* checkCategoryExists(dto.category_id);
    }

    if (dto.primary_supplier_id) {
      yield* checkSupplierExists(dto.primary_supplier_id);
    }
  });
};
