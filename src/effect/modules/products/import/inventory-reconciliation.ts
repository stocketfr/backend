import { Effect } from 'effect';
import { ProductsInfrastructureError } from '../products.errors';
import type { ProductImportRepository } from './repository';
import type {
  ImportCaches,
  ImportInventoryTarget,
  ImportProductRow,
  NormalizedProductImportRow,
  ProductImportResultDto,
} from './types';
import { parseInteger } from './utils';

export const validateRootInventoryImport = (
  repository: ProductImportRepository,
  row: NormalizedProductImportRow,
  caches: ImportCaches,
  target: ImportInventoryTarget,
) =>
  Effect.gen(function* () {
    if (!target.locationId || target.areaId) return;

    const cachedProduct = caches.products.get(row.sku);
    let product = cachedProduct ?? null;
    if (!product) {
      product = yield* repository.findProductBySku(row.sku);
    }
    if (!product) return;

    const hasAreaScopedInventory =
      yield* repository.hasAreaScopedInventoryForProductAndLocation(
        product.id,
        target.locationId,
      );
    if (hasAreaScopedInventory) {
      return yield* Effect.fail(
        new ProductsInfrastructureError({
          action: 'import root inventory with area-scoped inventory',
          messageKey: 'products.importAreaScopedInventoryConflict',
        }),
      );
    }
  });

export const upsertImportInventory = (
  repository: ProductImportRepository,
  product: ImportProductRow,
  target: ImportInventoryTarget,
  row: NormalizedProductImportRow,
  result: ProductImportResultDto,
  expiryDate: Date | null,
) =>
  Effect.gen(function* () {
    if (!target.locationId) return;

    const existing = yield* repository.findInventoryByProductLocationAndArea(
      product.id,
      target.locationId,
      target.areaId,
    );
    const quantity = parseInteger(row.quantity, 0);

    if (target.areaId === null) {
      const hasAreaScopedInventory =
        yield* repository.hasAreaScopedInventoryForProductAndLocation(
          product.id,
          target.locationId,
        );
      if (hasAreaScopedInventory) {
        return yield* Effect.fail(
          new ProductsInfrastructureError({
            action: 'import root inventory with area-scoped inventory',
            messageKey: 'products.importAreaScopedInventoryConflict',
          }),
        );
      }
    }

    const inventoryValues = {
      quantity,
      expiry_date: expiryDate,
      area_id: target.areaId,
    };

    if (!existing) {
      yield* repository.createInventory({
        product_id: product.id,
        location_id: target.locationId,
        ...inventoryValues,
      });
      result.inventoryRecordsCreated++;
      return;
    }

    const inventory = yield* repository.updateInventory(
      existing.id,
      inventoryValues,
    );
    if (!inventory) {
      return yield* Effect.fail(
        new ProductsInfrastructureError({
          action: 'update import inventory',
          messageKey: 'products.repositoryFailed',
        }),
      );
    }

    result.inventoryRecordsUpdated++;
  });
