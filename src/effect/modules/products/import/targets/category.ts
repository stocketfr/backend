import { Effect } from 'effect';
import type {
  ImportCaches,
  ImportCategoryRow,
  ProductImportResultDto,
} from '../types';
import { normalizeCategoryPath } from '../utils/csv';
import {
  type ProductImportTargetError,
  type ProductImportTargetRepository,
} from './types';
import { ProductsInfrastructureError } from '../../products.errors';

interface GetOrCreateCategoryPathOptions {
  readonly repository: ProductImportTargetRepository;
  readonly categoryPath: string;
  readonly caches: ImportCaches;
  readonly result: ProductImportResultDto;
}

export const getOrCreateCategoryPath = ({
  repository,
  categoryPath,
  caches,
  result,
}: GetOrCreateCategoryPathOptions): Effect.Effect<
  string,
  ProductImportTargetError
> =>
  Effect.gen(function* () {
    const parts = normalizeCategoryPath(categoryPath)
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length === 0) {
      return yield* Effect.fail(
        new ProductsInfrastructureError({
          action: 'resolve import category path',
          messageKey: 'products.repositoryFailed',
        }),
      );
    }

    let parentId: string | null = null;
    let categoryId = '';

    for (const part of parts) {
      const cacheKey = `${parentId ?? 'root'}:${part}`;
      const cached = caches.categories.get(cacheKey);
      if (cached) {
        parentId = cached;
        categoryId = cached;
        continue;
      }

      let category: ImportCategoryRow | null =
        yield* repository.findCategoryByNameAndParent(part, parentId);

      if (!category) {
        category = yield* repository.createCategory({
          name: part,
          parent_id: parentId,
          description: 'Imported via product import',
        });
        result.categoriesCreated++;
      }

      caches.categories.set(cacheKey, category.id);
      parentId = category.id;
      categoryId = category.id;
    }

    return categoryId;
  });
