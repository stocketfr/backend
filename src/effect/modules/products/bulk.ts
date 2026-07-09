import { Effect } from 'effect';
import { runBulkByIds } from '../../platform/effect/run-bulk-by-ids';
import type {
  BulkDeleteDto,
  BulkRestoreDto,
  BulkUpdateStatusDto,
  ProductWithRelations,
} from './types';
import { toProductResponseDto } from './mappers';
import { ProductNotDeleted } from './products.errors';

interface ProductEntityRef {
  readonly id: string;
}

export interface ProductBulkRepository<RepositoryError = never> {
  readonly findByIds: (
    ids: readonly string[],
    includeDeleted?: boolean,
  ) => Effect.Effect<readonly ProductEntityRef[], RepositoryError>;
  readonly findDeletedByIds: (
    ids: readonly string[],
  ) => Effect.Effect<readonly ProductEntityRef[], RepositoryError>;
  readonly updateMany: (
    ids: readonly string[],
    values: { readonly is_active: boolean; readonly updated_by: string | null },
  ) => Effect.Effect<readonly string[], RepositoryError>;
  readonly softDelete: (
    id: string,
    userId?: string,
  ) => Effect.Effect<unknown, RepositoryError>;
  readonly hardDelete: (id: string) => Effect.Effect<unknown, RepositoryError>;
  readonly softDeleteMany: (
    ids: readonly string[],
    userId?: string,
  ) => Effect.Effect<readonly string[], RepositoryError>;
  readonly hardDeleteMany: (
    ids: readonly string[],
  ) => Effect.Effect<readonly string[], RepositoryError>;
  readonly restore: (id: string) => Effect.Effect<unknown, RepositoryError>;
  readonly restoreMany: (
    ids: readonly string[],
  ) => Effect.Effect<readonly string[], RepositoryError>;
}

interface ProductBulkWorkflowOptions<
  RepositoryError,
  GetProductError,
  GetProductContext,
> {
  readonly repository: ProductBulkRepository<RepositoryError>;
  readonly getProductOrFail: (
    id: string,
    includeDeleted?: boolean,
  ) => Effect.Effect<ProductWithRelations, GetProductError, GetProductContext>;
}

export const makeProductBulkWorkflows = <
  RepositoryError,
  GetProductError,
  GetProductContext,
>({
  repository,
  getProductOrFail,
}: ProductBulkWorkflowOptions<
  RepositoryError,
  GetProductError,
  GetProductContext
>) => {
  const bulkUpdateStatus = (bulkDto: BulkUpdateStatusDto, userId?: string) =>
    runBulkByIds({
      ids: bulkDto.ids,
      find: repository.findByIds,
      act: (idsToUpdate) =>
        repository.updateMany(idsToUpdate, {
          is_active: bulkDto.is_active,
          updated_by: userId ?? null,
        }),
      entityName: 'Product',
    });

  const remove = (id: string, userId?: string, permanent = false) =>
    Effect.gen(function* () {
      yield* getProductOrFail(id);
      if (permanent) {
        yield* repository.hardDelete(id);
      } else {
        yield* repository.softDelete(id, userId);
      }
    });

  const bulkDelete = (bulkDto: BulkDeleteDto, userId?: string) =>
    runBulkByIds({
      ids: bulkDto.ids,
      find: repository.findByIds,
      act: (idsToDelete) =>
        bulkDto.permanent
          ? repository.hardDeleteMany(idsToDelete)
          : repository.softDeleteMany(idsToDelete, userId),
      entityName: 'Product',
    });

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
    });

  const bulkRestore = (bulkDto: BulkRestoreDto) =>
    runBulkByIds({
      ids: bulkDto.ids,
      find: repository.findDeletedByIds,
      act: repository.restoreMany,
      notFoundError: 'Product not found or not deleted',
    });

  return {
    bulkUpdateStatus,
    delete: remove,
    bulkDelete,
    restore,
    bulkRestore,
  };
};
