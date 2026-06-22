import { Effect } from 'effect';
import { LocationType } from '@stocket/types/locations';
import type {
  ImportCaches,
  ImportAreaRow,
  ImportCategoryRow,
  ImportLocationRow,
  ImportProductRow,
  ImportProductsFromCsvOptions,
  NormalizedProductImportRow,
  PreviewProductsFromCsvOptions,
  ProductImportCommitResultDto,
  ProductImportPreviewDto,
  ProductImportResultDto,
  ProductImportValues,
} from './types';
import {
  applyProductImportMapping,
  detectProductImportFormat,
  findConflictingDuplicateSkuRows,
  formatImportError,
  makeEmptyProductImportCommitResult,
  makeProductImportMappingLookups,
  makeProductImportPreview,
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
  pushWarning,
} from './utils';
import {
  ProductImportCsvParseFailed,
  ProductImportUnsupportedFormat,
  ProductsInfrastructureError,
} from '../products.errors';
import { ProductImportRepository } from './repository';
import { PhotosService } from '../../photos/service';

export class ProductImportService extends Effect.Service<ProductImportService>()(
  '@stocket/effect/products/ProductImportService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* ProductImportRepository;
      const photosService = yield* PhotosService;

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
        result: ProductImportCommitResultDto,
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

      const getOrCreateAreaPath = (
        locationId: string,
        areaPath: string,
        caches: ImportCaches,
        result: ProductImportCommitResultDto,
      ) =>
        Effect.gen(function* () {
          const parts = areaPath
            .split('/')
            .map((part) => part.trim())
            .filter(Boolean);
          if (parts.length === 0) return null;

          let parentId: string | null = null;
          let areaId = '';

          for (const part of parts) {
            const cacheKey = `${locationId}:${parentId ?? 'root'}:${part}`;
            const cached = caches.areas.get(cacheKey);
            if (cached) {
              parentId = cached;
              areaId = cached;
              continue;
            }

            let area: ImportAreaRow | null =
              yield* repository.findAreaByNameLocationAndParent(
                part,
                locationId,
                parentId,
              );

            if (!area) {
              area = yield* repository.createArea({
                location_id: locationId,
                parent_id: parentId,
                name: part,
                code: '',
                description: 'Imported via product import',
                is_active: true,
              });
              result.areasCreated++;
            }

            caches.areas.set(cacheKey, area.id);
            parentId = area.id;
            areaId = area.id;
          }

          return areaId;
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
            is_perishable: parseBoolean(row.is_perishable, Boolean(expiryDate)),
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

          const product = yield* repository.updateProduct(existing.id, {
            ...values,
            updated_by: updatedBy,
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
        product: ImportProductRow,
        locationId: string | null,
        areaId: string | null,
        row: NormalizedProductImportRow,
        result: ProductImportCommitResultDto,
        expiryDate: Date | null,
      ) =>
        Effect.gen(function* () {
          if (!locationId) return;

          const existing = yield* repository.findInventoryByProductLocationArea(
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

          if (!existing) {
            yield* repository.createInventory({
              product_id: product.id,
              location_id: locationId,
              area_id: areaId,
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

      const importPhotosForProduct = (
        product: ImportProductRow,
        row: NormalizedProductImportRow,
        result: ProductImportCommitResultDto,
        userId: string,
        importedPhotoProducts: Set<string>,
      ) =>
        Effect.gen(function* () {
          if (
            row.photo_urls.length === 0 ||
            importedPhotoProducts.has(product.id)
          ) {
            return;
          }
          importedPhotoProducts.add(product.id);

          for (const photoUrl of row.photo_urls) {
            const response = yield* Effect.tryPromise({
              try: () => fetch(photoUrl),
              catch: (cause) => cause,
            }).pipe(
              Effect.catchAll((cause) =>
                Effect.sync(() => {
                  pushWarning(
                    result,
                    `Failed to download Sortly photo ${photoUrl}: ${formatImportError(cause)}`,
                    row.sourceRow,
                  );
                  return null;
                }),
              ),
            );
            if (!response) continue;

            if (!response.ok) {
              pushWarning(
                result,
                `Failed to download Sortly photo ${photoUrl}: HTTP ${response.status}`,
                row.sourceRow,
              );
              continue;
            }

            const contentType =
              response.headers.get('content-type') ??
              'application/octet-stream';
            const arrayBuffer = yield* Effect.tryPromise({
              try: () => response.arrayBuffer(),
              catch: (cause) => cause,
            }).pipe(
              Effect.catchAll((cause) =>
                Effect.sync(() => {
                  pushWarning(
                    result,
                    `Failed to read Sortly photo ${photoUrl}: ${formatImportError(cause)}`,
                    row.sourceRow,
                  );
                  return null;
                }),
              ),
            );
            if (!arrayBuffer) continue;

            const buffer = Buffer.from(arrayBuffer);
            const filename =
              photoUrl.split('/').pop()?.split('?')[0] || 'sortly-photo';
            yield* photosService
              .uploadPhoto(
                product.id,
                {
                  originalname: filename,
                  mimetype: contentType,
                  size: buffer.length,
                  buffer,
                },
                userId,
              )
              .pipe(
                Effect.match({
                  onFailure: (error) => {
                    pushWarning(
                      result,
                      `Failed to import Sortly photo ${photoUrl}: ${formatImportError(error)}`,
                      row.sourceRow,
                    );
                  },
                  onSuccess: () => {
                    result.photosImported++;
                  },
                }),
              );
          }
        });

      const validateRootInventoryImport = (
        row: NormalizedProductImportRow,
        caches: ImportCaches,
      ) =>
        Effect.gen(function* () {
          const locationName = row.location.trim();
          if (locationName === '' || row.area_path.trim() !== '') return;

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
        result: ProductImportCommitResultDto,
        expiryDate: Date | null,
        userId: string,
        importedPhotoProducts: Set<string>,
        importPhotos: boolean,
      ) =>
        Effect.gen(function* () {
          if (row.area_path.trim() !== '' && row.location.trim() === '') {
            return yield* Effect.fail(
              new Error('Cannot import area_path without location'),
            );
          }

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
          const areaId = locationId
            ? yield* getOrCreateAreaPath(
                locationId,
                row.area_path,
                caches,
                result,
              )
            : null;
          yield* upsertInventory(
            product,
            locationId,
            areaId,
            row,
            result,
            expiryDate,
          );
          if (importPhotos) {
            yield* importPhotosForProduct(
              product,
              row,
              result,
              userId,
              importedPhotoProducts,
            );
          }
        });

      const parseImportRequest = (
        content: string,
        importType: ImportProductsFromCsvOptions['importType'],
      ) =>
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
          return { parsed, format };
        });

      const previewFromCsvContent = ({
        content,
        importType = 'auto',
        knownLocations = [],
        useLlm = false,
      }: PreviewProductsFromCsvOptions): Effect.Effect<
        ProductImportPreviewDto,
        ProductImportCsvParseFailed | ProductImportUnsupportedFormat
      > =>
        Effect.gen(function* () {
          const { parsed, format } = yield* parseImportRequest(
            content,
            importType,
          );
          return makeProductImportPreview(parsed, format, {
            knownLocations,
            useLlm,
          });
        }).pipe(Effect.withSpan('ProductImportService.previewFromCsvContent'));

      const importFromCsvContent = ({
        content,
        importType = 'auto',
        mapping,
        importPhotos = false,
        userId,
      }: ImportProductsFromCsvOptions): Effect.Effect<
        ProductImportCommitResultDto,
        ProductImportCsvParseFailed | ProductImportUnsupportedFormat
      > =>
        Effect.gen(function* () {
          const { parsed, format } = yield* parseImportRequest(
            content,
            importType,
          );
          const result = makeEmptyProductImportCommitResult();
          const mappingLookups = makeProductImportMappingLookups(mapping);
          const rows: NormalizedProductImportRow[] = [];
          for (const rawRow of normalizeProductImportRecords(
            parsed.records,
            format,
          )) {
            const mapped = applyProductImportMapping(rawRow, mappingLookups);
            if (mapped.error) {
              pushRowError(result, rawRow.sourceRow, mapped.error);
              continue;
            }
            rows.push(mapped.row);
          }

          const duplicateConflictRows = findConflictingDuplicateSkuRows(rows, {
            includeReorderPoint: format === 'normalized-products',
          });
          const caches: ImportCaches = {
            areas: new Map<string, string>(),
            categories: new Map<string, string>(),
            locations: new Map<string, string>(),
            products: new Map<string, ImportProductRow>(),
          };
          const importedPhotoProducts = new Set<string>();

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

            yield* importRow(
              row,
              caches,
              result,
              expiryDate,
              userId,
              importedPhotoProducts,
              importPhotos,
            ).pipe(
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  pushRowError(result, row.sourceRow, formatImportError(error));
                }),
              ),
            );
          }

          return result;
        }).pipe(Effect.withSpan('ProductImportService.importFromCsvContent'));

      return {
        previewFromCsvContent,
        commitFromCsvContent: importFromCsvContent,
        importFromCsvContent,
      };
    }),
    dependencies: [ProductImportRepository.Default, PhotosService.Default],
  },
) {}
