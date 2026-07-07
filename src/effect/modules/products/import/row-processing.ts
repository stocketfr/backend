import { Effect } from 'effect';
import {
  validateRootInventoryImport,
  upsertImportInventory,
} from './inventory-reconciliation';
import { importProductPhotos } from './photo-accounting';
import { upsertImportProduct } from './product-reconciliation';
import {
  getOrCreateCategoryPath,
  getTargetCategoryPath,
  resolveInventoryTarget,
} from './target-resolution';
import type { ProcessProductImportRowOptions } from './types';

export const processProductImportRow = ({
  services,
  row,
  state,
  expiryDate,
  userId,
  approvedPlan,
}: ProcessProductImportRowOptions) =>
  Effect.gen(function* () {
    const { repository, photoImporter } = services;
    const { caches, result } = state;

    const inventoryTarget = yield* resolveInventoryTarget(
      repository,
      row,
      caches,
      result,
      approvedPlan,
    );
    yield* validateRootInventoryImport(
      repository,
      row,
      caches,
      inventoryTarget,
    );

    const categoryId = yield* getOrCreateCategoryPath(
      repository,
      getTargetCategoryPath(row, approvedPlan),
      caches,
      result,
    );
    const product = yield* upsertImportProduct(
      repository,
      row,
      categoryId,
      caches,
      result,
      expiryDate,
      userId,
    );

    yield* upsertImportInventory(
      repository,
      product,
      inventoryTarget,
      row,
      result,
      expiryDate,
    );
    yield* importProductPhotos(
      photoImporter,
      product,
      row,
      caches,
      result,
      userId,
    );
  });
