import { Effect } from 'effect';
import type {
  ImportCaches,
  ImportInventoryRow,
  ImportProductRow,
  NormalizedProductImportRow,
  ProductImportPlan,
  ProductImportResultDto,
} from '../types';
import { getTargetCategoryPath } from '../plan';
import { getOrCreateCategoryPath } from '../targets/category';
import { resolveInventoryTarget } from '../targets/inventory';
import {
  type ImportInventoryTarget,
  type ProductImportTargetError,
  type ProductImportTargetRepository,
} from '../targets/types';
import { productValuesMatch } from '../utils/result';
import { parseInteger } from '../utils/value-parsers';
import { ProductsInfrastructureError } from '../../products.errors';
import {
  toProductImportValues,
  type ProductImportProductCreateValues,
  type ProductImportProductUpdateValues,
} from './values';
import {
  importProductPhotos,
  type ProductImportPhotoImporterPort,
} from './photos';

export type { ProductImportPhotoImporterPort } from './photos';

interface ProductImportInventoryValues {
  readonly quantity: number;
  readonly expiry_date: Date | null;
  readonly area_id: string | null;
}

interface ProductImportInventoryCreateValues
  extends ProductImportInventoryValues {
  readonly product_id: string;
  readonly location_id: string;
}

export interface ProductImportRowRepository
  extends ProductImportTargetRepository {
  readonly findProductBySku: (
    sku: string,
  ) => Effect.Effect<ImportProductRow | null, ProductImportTargetError>;
  readonly createProduct: (
    data: ProductImportProductCreateValues,
  ) => Effect.Effect<ImportProductRow, ProductImportTargetError>;
  readonly updateProduct: (
    id: string,
    data: ProductImportProductUpdateValues,
  ) => Effect.Effect<ImportProductRow | null, ProductImportTargetError>;
  readonly findInventoryByProductLocationAndArea: (
    productId: string,
    locationId: string,
    areaId: string | null,
  ) => Effect.Effect<ImportInventoryRow | null, ProductImportTargetError>;
  readonly hasAreaScopedInventoryForProductAndLocation: (
    productId: string,
    locationId: string,
  ) => Effect.Effect<boolean, ProductImportTargetError>;
  readonly createInventory: (
    data: ProductImportInventoryCreateValues,
  ) => Effect.Effect<ImportInventoryRow, ProductImportTargetError>;
  readonly updateInventory: (
    id: string,
    data: ProductImportInventoryValues,
  ) => Effect.Effect<ImportInventoryRow | null, ProductImportTargetError>;
}

interface ImportProductRowOptions {
  readonly repository: ProductImportRowRepository;
  readonly photoImporter: ProductImportPhotoImporterPort;
  readonly row: NormalizedProductImportRow;
  readonly caches: ImportCaches;
  readonly result: ProductImportResultDto;
  readonly expiryDate: Date | null;
  readonly userId: string;
  readonly approvedPlan: ProductImportPlan | undefined;
}

const upsertProduct = (
  repository: ProductImportRowRepository,
  row: NormalizedProductImportRow,
  categoryId: string,
  caches: ImportCaches,
  result: ProductImportResultDto,
  expiryDate: Date | null,
  userId: string,
) =>
  Effect.gen(function* () {
    const cached = caches.products.get(row.sku);
    if (cached) return cached;

    const values = toProductImportValues(row, categoryId, expiryDate);

    const existing = yield* repository.findProductBySku(row.sku);
    if (!existing) {
      const product = yield* repository.createProduct({
        sku: row.sku,
        ...values,
        created_by: userId,
        updated_by: userId,
      });
      result.productsCreated++;
      caches.products.set(row.sku, product);
      return product;
    }

    if (productValuesMatch(existing, values)) {
      caches.products.set(row.sku, existing);
      return existing;
    }

    const product = yield* repository.updateProduct(existing.id, {
      ...values,
      updated_by: userId,
    });
    if (!product) {
      return yield* Effect.fail(
        new ProductsInfrastructureError({
          action: 'update import product',
          messageKey: 'products.repositoryFailed',
        }),
      );
    }
    result.productsUpdated++;
    caches.products.set(row.sku, product);
    return product;
  });

const upsertInventory = (
  repository: ProductImportRowRepository,
  product: ImportProductRow,
  locationId: string | null,
  areaId: string | null,
  row: NormalizedProductImportRow,
  result: ProductImportResultDto,
  expiryDate: Date | null,
) =>
  Effect.gen(function* () {
    if (!locationId) return;

    const existing = yield* repository.findInventoryByProductLocationAndArea(
      product.id,
      locationId,
      areaId,
    );
    const quantity = parseInteger(row.quantity, 0);
    if (areaId === null) {
      const hasAreaScopedInventory =
        yield* repository.hasAreaScopedInventoryForProductAndLocation(
          product.id,
          locationId,
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
      area_id: areaId,
    };

    if (!existing) {
      yield* repository.createInventory({
        product_id: product.id,
        location_id: locationId,
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

const validateRootInventoryImport = (
  repository: ProductImportRowRepository,
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

export const importProductRow = ({
  repository,
  photoImporter,
  row,
  caches,
  result,
  expiryDate,
  userId,
  approvedPlan,
}: ImportProductRowOptions): Effect.Effect<void, ProductImportTargetError> =>
  Effect.gen(function* () {
    const inventoryTarget = yield* resolveInventoryTarget({
      repository,
      row,
      caches,
      result,
      approvedPlan,
    });
    yield* validateRootInventoryImport(
      repository,
      row,
      caches,
      inventoryTarget,
    );
    const categoryId = yield* getOrCreateCategoryPath({
      repository,
      categoryPath: getTargetCategoryPath(row, approvedPlan),
      caches,
      result,
    });
    const product = yield* upsertProduct(
      repository,
      row,
      categoryId,
      caches,
      result,
      expiryDate,
      userId,
    );
    yield* upsertInventory(
      repository,
      product,
      inventoryTarget.locationId,
      inventoryTarget.areaId,
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
