import { Effect } from 'effect';
import type { ProductsRepository } from './repository';
import { toProductResponseDto } from './mappers';
import { toPaginatedResponse } from '@stocket/types/common';
import type { ProductQueryDto } from './types';

export type ProductCategoryRepository = Pick<
  ProductsRepository,
  'findByCategoryIdsPaginated'
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
  const findByCategory = (categoryId: string, query: ProductQueryDto) =>
    Effect.gen(function* () {
      yield* checkCategoryExists(categoryId);
      const result = yield* repository.findByCategoryIdsPaginated(
        [categoryId],
        query,
      );
      return toPaginatedResponse(result, toProductResponseDto);
    });

  const findByCategoryTree = (categoryId: string, query: ProductQueryDto) =>
    Effect.gen(function* () {
      yield* checkCategoryExists(categoryId);
      const descendantIds = yield* findAllDescendantIds(categoryId);
      const categoryIds = [categoryId, ...descendantIds];
      const result = yield* repository.findByCategoryIdsPaginated(
        categoryIds,
        query,
      );
      return toPaginatedResponse(result, toProductResponseDto);
    });

  return { findByCategory, findByCategoryTree };
};
