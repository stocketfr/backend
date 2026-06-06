import { Effect } from 'effect';
import { LocationType } from '@stocket/types/locations';
import type {
  ImportCaches,
  ImportCategoryRow,
  ImportLocationRow,
  ImportProductRow,
  ImportProductsFromCsvOptions,
  NormalizedProductImportRow,
  ProductImportResultDto,
  ProductImportValues,
} from './types';
import {
  detectProductImportFormat,
  findConflictingDuplicateSkuRows,
  formatImportError,
  makeEmptyProductImportResult,
  normalizeCategoryPath,
  normalizeProductImportRecords,
  nullableText,
  parseBoolean,
  parseCsvContent,
  parseDate,
  parseInteger,
  parseProductImportNumber,
  productValuesMatch,
  pushRowError,
} from './utils';
import {
  ProductImportCsvParseFailed,
  ProductImportUnsupportedFormat,
  ProductsInfrastructureError,
} from '../products.errors';
import { ProductImportRepository } from './repository';

export class ProductImportService extends Effect.Service<ProductImportService>()(
  '@stocket/effect/products/ProductImportService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* ProductImportRepository;

      const getOrCreateCategoryPath = (
        categoryPath: string,
        caches: ImportCaches,
        result: ProductImportResultDto,
      ) =>
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

      const getOrCreateLocation = (
        locationName: string,
        caches: ImportCaches,
        result: ProductImportResultDto,
      ) =>
        Effect.gen(function* () {
          const name = locationName.trim();
          if (name === '') return null;

          const cached = caches.locations.get(name);
          if (cached) return cached;

          let location: ImportLocationRow | null =
            yield* repository.findLocationByName(name);

          if (!location) {
            location = yield* repository.createLocation({
              name,
              type: LocationType.WAREHOUSE,
              address: '',
              contact_person: '',
              phone: '',
              is_active: true,
            });
            result.locationsCreated++;
          }

          caches.locations.set(name, location.id);
          return location.id;
        });

      const upsertProduct = (
        row: NormalizedProductImportRow,
        categoryId: string,
        caches: ImportCaches,
        result: ProductImportResultDto,
        expiryDate: Date | null,
        userId: string,
      ) =>
        Effect.gen(function* () {
          const updatedBy = userId;
          const cached = caches.products.get(row.sku);
          if (cached) return cached;

          const values: ProductImportValues = {
            name: row.name,
            description: nullableText(row.description),
            category_id: categoryId,
            unit: nullableText(row.unit),
            barcode: nullableText(row.barcode),
            standard_price: parseProductImportNumber(row.standard_price),
            reorder_point: parseInteger(row.reorder_point, 0),
            is_active: parseBoolean(row.is_active, true),
            is_perishable: parseBoolean(
              row.is_perishable,
              Boolean(expiryDate),
            ),
            notes: nullableText(row.notes),
          };

          const existing = yield* repository.findProductBySku(row.sku);
          if (!existing) {
            const product = yield* repository.createProduct({
              sku: row.sku,
              ...values,
              created_by: updatedBy,
              updated_by: updatedBy,
            });
            result.productsCreated++;
            caches.products.set(row.sku, product);
            return product;
          }

          if (productValuesMatch(existing, values)) {
            caches.products.set(row.sku, existing);
            return existing;
          }

          const product = yield* repository.updateProduct(
            existing.id,
            { ...values, updated_by: updatedBy },
          );
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
        product: ImportProductRow,
        locationId: string | null,
        row: NormalizedProductImportRow,
        result: ProductImportResultDto,
        expiryDate: Date | null,
      ) =>
        Effect.gen(function* () {
          if (!locationId) return;

          const existing =
            yield* repository.findRootInventoryByProductAndLocation(
              product.id,
              locationId,
            );
          const quantity = parseInteger(row.quantity, 0);
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

          if (!existing) {
            yield* repository.createInventory({
              product_id: product.id,
              location_id: locationId,
              quantity,
              expiry_date: expiryDate,
            });
            result.inventoryRecordsCreated++;
            return;
          }

          const inventory = yield* repository.updateInventory(existing.id, {
            quantity,
            expiry_date: expiryDate,
          });
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
        row: NormalizedProductImportRow,
        caches: ImportCaches,
      ) =>
        Effect.gen(function* () {
          const locationName = row.location.trim();
          if (locationName === '') return;

          const cachedProduct = caches.products.get(row.sku);
          let product = cachedProduct ?? null;
          if (!product) {
            product = yield* repository.findProductBySku(row.sku);
          }
          if (!product) return;

          let locationId = caches.locations.get(locationName) ?? null;
          if (!locationId) {
            const location = yield* repository.findLocationByName(locationName);
            locationId = location?.id ?? null;
          }
          if (!locationId) return;

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
        });

      const importRow = (
        row: NormalizedProductImportRow,
        caches: ImportCaches,
        result: ProductImportResultDto,
        expiryDate: Date | null,
        userId: string,
      ) =>
        Effect.gen(function* () {
          yield* validateRootInventoryImport(row, caches);
          const categoryId = yield* getOrCreateCategoryPath(
            row.category_path,
            caches,
            result,
          );
          const product = yield* upsertProduct(
            row,
            categoryId,
            caches,
            result,
            expiryDate,
            userId,
          );
          const locationId = yield* getOrCreateLocation(
            row.location,
            caches,
            result,
          );
          yield* upsertInventory(product, locationId, row, result, expiryDate);
        });

      const importFromCsvContent = ({
        content,
        importType = 'auto',
        userId,
      }: ImportProductsFromCsvOptions): Effect.Effect<
        ProductImportResultDto,
        ProductImportCsvParseFailed | ProductImportUnsupportedFormat
      > =>
        Effect.gen(function* () {
          const parsed = yield* Effect.try({
            try: () => parseCsvContent(content),
            catch: (cause) =>
              new ProductImportCsvParseFailed({
                cause,
                messageKey: 'products.importCsvParseFailed',
              }),
          });
          const format = detectProductImportFormat(parsed.headers, importType);
          if (!format) {
            return yield* Effect.fail(
              new ProductImportUnsupportedFormat({
                messageKey: 'products.importUnsupportedFormat',
              }),
            );
          }

          const result = makeEmptyProductImportResult();
          const rows = normalizeProductImportRecords(parsed.records, format);
          const duplicateConflictRows = findConflictingDuplicateSkuRows(rows, {
            includeReorderPoint: format === 'normalized-products',
          });
          const caches: ImportCaches = {
            categories: new Map<string, string>(),
            locations: new Map<string, string>(),
            products: new Map<string, ImportProductRow>(),
          };

          for (const row of rows) {
            if (!row.sku || !row.name) {
              pushRowError(
                result,
                row.sourceRow,
                'Cannot import product without sku and name',
              );
              continue;
            }

            if (duplicateConflictRows.has(row.sourceRow)) {
              pushRowError(
                result,
                row.sourceRow,
                `Conflicting duplicate SKU "${row.sku}" has different product fields`,
              );
              continue;
            }

            const expiryDate = parseDate(row.expiry_date);
            if (row.expiry_date.trim() !== '' && expiryDate === null) {
              pushRowError(
                result,
                row.sourceRow,
                `Invalid expiry_date "${row.expiry_date}"`,
              );
              continue;
            }

            yield* importRow(row, caches, result, expiryDate, userId).pipe(
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  pushRowError(
                    result,
                    row.sourceRow,
                    formatImportError(error),
                  );
                }),
              ),
            );
          }

          return result;
        }).pipe(Effect.withSpan('ProductImportService.importFromCsvContent'));

      return {
        importFromCsvContent,
      };
    }),
    dependencies: [ProductImportRepository.Default],
  },
) {}
