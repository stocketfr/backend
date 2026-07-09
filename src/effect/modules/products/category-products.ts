import { Effect } from 'effect';
import type { ProductsRepository } from './repository';
import { toProductResponseDto } from './mappers';

export type ProductCategoryRepository = Pick<
  ProductsRepository,
  'findByCategoryId' | 'findByCategoryIds'
>;

interface ProductCategoryWorkflowOptions<
  CategoryError,
  CategoryContext,
  DescendantError,
  DescendantContext,
> {
  readonly repository: ProductCategoryRepository;
  readonly checkCategoryExists: (
    categoryId: string,
  ) => Effect.Effect<void, CategoryError, CategoryContext>;
  readonly findAllDescendantIds: (
    categoryId: string,
  ) => Effect.Effect<readonly string[], DescendantError, DescendantContext>;
}

export const makeProductCategoryWorkflows = <
  CategoryError,
  CategoryContext,
  DescendantError,
  DescendantContext,
>({
  repository,
  checkCategoryExists,
  findAllDescendantIds,
}: ProductCategoryWorkflowOptions<
  CategoryError,
  CategoryContext,
  DescendantError,
  DescendantContext
>) => {
  const findByCategory = (categoryId: string) =>
    Effect.gen(function* () {
      yield* checkCategoryExists(categoryId);
      const products = yield* repository.findByCategoryId(categoryId);
      return products.map(toProductResponseDto);
    });

  const findByCategoryTree = (categoryId: string) =>
    Effect.gen(function* () {
      yield* checkCategoryExists(categoryId);
      const descendantIds = yield* findAllDescendantIds(categoryId);
      const categoryIds = [categoryId, ...descendantIds];
      const products = yield* repository.findByCategoryIds(categoryIds);
      return products.map(toProductResponseDto);
    });

  return { findByCategory, findByCategoryTree };
};
