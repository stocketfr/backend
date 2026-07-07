import { Effect } from 'effect';
import { LocationType } from '@stocket/types/locations';
import type {
  AnalyzeProductsFromCsvOptions,
  ImportCaches,
  ImportAreaRow,
  ImportCategoryRow,
  ImportLocationRow,
  ImportProductRow,
  ImportProductsFromCsvOptions,
  NormalizedProductImportRow,
  ProductImportAiProposalDto,
  ProductImportApprovedPlanDto,
  ProductImportProgress,
  ProductImportLocationMappingDto,
  ProductImportPreviewDto,
  ProductImportResultDto,
  ProductImportValues,
} from './types';
import {
  detectProductImportFormat,
  deriveConflictingDuplicateSkuRows,
  findConflictingDuplicateSkuRows,
  formatImportError,
  makeProductImportPreview,
  makeEmptyProductImportResult,
  normalizeCategoryPath,
  normalizeStorageLocationName,
  normalizeProductImportRecords,
  isSupportedSortlyPhotoUrl,
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
  ProductImportCancelled,
  ProductImportUnsupportedFormat,
  ProductsInfrastructureError,
} from '../products.errors';
import { ProductImportLlmProposer } from './llm-proposer';
import { ProductImportPhotoImporter } from './photo-importer';
import { PRODUCT_IMPORT_PROGRESS_MESSAGES } from './progress';
import { ProductImportRepository } from './repository';

export class ProductImportService extends Effect.Service<ProductImportService>()(
  '@stocket/effect/products/ProductImportService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* ProductImportRepository;
      const llmProposer = yield* ProductImportLlmProposer;
      const photoImporter = yield* ProductImportPhotoImporter;

      const parseAndDetectFormat = ({
        content,
        importType = 'auto',
      }: AnalyzeProductsFromCsvOptions) =>
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

      const findLocationId = (locationId: string, caches: ImportCaches) =>
        Effect.gen(function* () {
          const cached = caches.locations.get(locationId);
          if (cached) return cached;

          const location = yield* repository.findLocationById(locationId);
          if (!location) {
            return yield* Effect.fail(
              new ProductsInfrastructureError({
                action: 'resolve import location by id',
                messageKey: 'products.repositoryFailed',
              }),
            );
          }

          caches.locations.set(location.id, location.id);
          caches.locations.set(location.name, location.id);
          return location.id;
        });

      const getOrCreateAreaPath = (
        locationId: string,
        areaPath: string,
        caches: ImportCaches,
        result: ProductImportResultDto,
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
                locationId,
                part,
                parentId,
              );

            if (!area) {
              area = yield* repository.createArea({
                location_id: locationId,
                parent_id: parentId,
                name: part,
                description: 'Imported via product import',
                code: '',
                is_active: true,
              });
              result.areasCreated = (result.areasCreated ?? 0) + 1;
            }

            caches.areas.set(cacheKey, area.id);
            parentId = area.id;
            areaId = area.id;
          }

          return areaId;
        });

      const findLocationMapping = (
        row: NormalizedProductImportRow,
        approvedPlan: ProductImportApprovedPlanDto | undefined,
      ): ProductImportLocationMappingDto | undefined => {
        const sourceLocation = normalizeStorageLocationName(row.location);
        return approvedPlan?.locationMappings?.find(
          (mapping) =>
            normalizeStorageLocationName(mapping.sourceLocation) ===
            sourceLocation,
        );
      };

      const getTargetCategoryPath = (
        row: NormalizedProductImportRow,
        approvedPlan: ProductImportApprovedPlanDto | undefined,
      ): string => {
        const sourcePath = normalizeCategoryPath(row.category_path);
        const mapping = approvedPlan?.categoryMappings?.find(
          (candidate) =>
            normalizeCategoryPath(candidate.sourcePath) === sourcePath,
        );
        return normalizeCategoryPath(mapping?.targetPath ?? sourcePath);
      };

      const resolveInventoryTarget = (
        row: NormalizedProductImportRow,
        caches: ImportCaches,
        result: ProductImportResultDto,
        approvedPlan: ProductImportApprovedPlanDto | undefined,
      ) =>
        Effect.gen(function* () {
          const rawLocation = row.location.trim();
          if (rawLocation === '') {
            return { locationId: null, areaId: null } as const;
          }

          const mapping = findLocationMapping(row, approvedPlan);
          if (mapping?.action === 'ignore') {
            return { locationId: null, areaId: null } as const;
          }

          if (mapping?.action === 'create-area' && mapping.areaPath) {
            const targetLocationName =
              mapping.targetLocationName?.trim() ||
              approvedPlan?.defaultLocationName?.trim() ||
              '';
            const locationId = mapping.targetLocationId
              ? yield* findLocationId(mapping.targetLocationId, caches)
              : yield* getOrCreateLocation(targetLocationName, caches, result);

            if (!locationId) {
              return yield* Effect.fail(
                new ProductsInfrastructureError({
                  action: 'resolve import area location',
                  messageKey: 'products.importAreaLocationRequired',
                }),
              );
            }

            const areaId = yield* getOrCreateAreaPath(
              locationId,
              mapping.areaPath,
              caches,
              result,
            );
            return { locationId, areaId } as const;
          }

          if (mapping?.targetLocationId) {
            const locationId = yield* findLocationId(
              mapping.targetLocationId,
              caches,
            );
            return { locationId, areaId: null } as const;
          }

          const locationName =
            mapping?.targetLocationName?.trim() ||
            (mapping
              ? normalizeStorageLocationName(row.location)
              : row.location);
          const locationId = yield* getOrCreateLocation(
            locationName,
            caches,
            result,
          );
          return { locationId, areaId: null } as const;
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
        result: ProductImportResultDto,
        expiryDate: Date | null,
      ) =>
        Effect.gen(function* () {
          if (!locationId) return;

          const existing =
            yield* repository.findInventoryByProductLocationAndArea(
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

      const pushPhotoImportError = (
        result: ProductImportResultDto,
        row: NormalizedProductImportRow,
        url: string,
        error: string,
      ) => {
        result.photosSkipped++;
        result.errors.push({
          row: row.sourceRow,
          error: `Photo import failed for "${url}": ${error}`,
        });
      };

      const importProductPhotos = (
        product: ImportProductRow,
        row: NormalizedProductImportRow,
        caches: ImportCaches,
        result: ProductImportResultDto,
        userId: string,
      ) =>
        Effect.gen(function* () {
          if (row.photo_urls.length === 0) return;

          let importedUrls = caches.photoUrlsByProduct.get(product.id);
          if (!importedUrls) {
            importedUrls = new Set<string>();
            caches.photoUrlsByProduct.set(product.id, importedUrls);
          }

          for (const [photoIndex, url] of row.photo_urls.entries()) {
            if (importedUrls.has(url)) continue;
            importedUrls.add(url);

            if (!isSupportedSortlyPhotoUrl(url)) {
              pushPhotoImportError(
                result,
                row,
                url,
                'Unsupported Sortly photo URL',
              );
              continue;
            }

            yield* photoImporter
              .importSortlyPhoto(product.id, url, photoIndex, userId)
              .pipe(
                Effect.matchEffect({
                  onFailure: (error) =>
                    Effect.sync(() => {
                      pushPhotoImportError(
                        result,
                        row,
                        url,
                        formatImportError(error),
                      );
                    }),
                  onSuccess: () =>
                    Effect.sync(() => {
                      result.photosCreated++;
                    }),
                }),
              );
          }
        });

      const validateRootInventoryImport = (
        row: NormalizedProductImportRow,
        caches: ImportCaches,
        target: {
          readonly locationId: string | null;
          readonly areaId: string | null;
        },
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

      const importRow = (
        row: NormalizedProductImportRow,
        caches: ImportCaches,
        result: ProductImportResultDto,
        expiryDate: Date | null,
        userId: string,
        approvedPlan: ProductImportApprovedPlanDto | undefined,
      ) =>
        Effect.gen(function* () {
          const inventoryTarget = yield* resolveInventoryTarget(
            row,
            caches,
            result,
            approvedPlan,
          );
          yield* validateRootInventoryImport(row, caches, inventoryTarget);
          const categoryId = yield* getOrCreateCategoryPath(
            getTargetCategoryPath(row, approvedPlan),
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
          yield* upsertInventory(
            product,
            inventoryTarget.locationId,
            inventoryTarget.areaId,
            row,
            result,
            expiryDate,
          );
          yield* importProductPhotos(product, row, caches, result, userId);
        });

      const importFromCsvContent = ({
        content,
        importType = 'auto',
        approvedPlan,
        userId,
        hooks,
      }: ImportProductsFromCsvOptions): Effect.Effect<
        ProductImportResultDto,
        | ProductImportCancelled
        | ProductImportCsvParseFailed
        | ProductImportUnsupportedFormat
        | ProductsInfrastructureError
      > =>
        Effect.gen(function* () {
          const { parsed, format } = yield* parseAndDetectFormat({
            content,
            importType,
          });

          const result = makeEmptyProductImportResult();
          const rows = normalizeProductImportRecords(parsed.records, format);
          let processedRows = 0;
          let failedRows = 0;
          const reportProgress = (message?: ProductImportProgress['message']) =>
            hooks?.onProgress
              ? hooks
                  .onProgress({
                    total: rows.length,
                    processed: processedRows,
                    failed: failedRows,
                    message,
                  })
                  .pipe(Effect.ignore)
              : Effect.void;
          const ensureNotCanceled = hooks?.isCancelRequested
            ? Effect.gen(function* () {
                const canceled = yield* hooks.isCancelRequested!.pipe(
                  Effect.catchAll(() => Effect.succeed(false)),
                );
                if (canceled) {
                  return yield* Effect.fail(
                    new ProductImportCancelled({
                      messageKey: 'products.importCancelled',
                    }),
                  );
                }
              })
            : Effect.void;

          yield* reportProgress(PRODUCT_IMPORT_PROGRESS_MESSAGES.starting);
          const duplicateConflictRows = findConflictingDuplicateSkuRows(rows, {
            includeReorderPoint: format === 'normalized-products',
          });
          const derivedSkusByRow =
            approvedPlan?.skuConflictPolicy === 'derive-sku'
              ? deriveConflictingDuplicateSkuRows(rows, {
                  includeReorderPoint: format === 'normalized-products',
                })
              : new Map<number, string>();
          const caches: ImportCaches = {
            categories: new Map<string, string>(),
            locations: new Map<string, string>(),
            areas: new Map<string, string>(),
            products: new Map<string, ImportProductRow>(),
            photoUrlsByProduct: new Map<string, Set<string>>(),
          };

          for (const originalRow of rows) {
            yield* ensureNotCanceled;
            const derivedSku = derivedSkusByRow.get(originalRow.sourceRow);
            const row = derivedSku
              ? { ...originalRow, sku: derivedSku }
              : originalRow;
            if (!row.sku || !row.name) {
              pushRowError(
                result,
                row.sourceRow,
                'Cannot import product without sku and name',
              );
              processedRows++;
              failedRows++;
              yield* reportProgress(
                PRODUCT_IMPORT_PROGRESS_MESSAGES.rowsProcessed,
              );
              continue;
            }

            if (duplicateConflictRows.has(row.sourceRow) && !derivedSku) {
              pushRowError(
                result,
                row.sourceRow,
                `Conflicting duplicate SKU "${row.sku}" has different product fields`,
              );
              processedRows++;
              failedRows++;
              yield* reportProgress(
                PRODUCT_IMPORT_PROGRESS_MESSAGES.rowsProcessed,
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
              processedRows++;
              failedRows++;
              yield* reportProgress(
                PRODUCT_IMPORT_PROGRESS_MESSAGES.rowsProcessed,
              );
              continue;
            }

            const errorsBeforeRow = result.errors.length;
            yield* importRow(
              row,
              caches,
              result,
              expiryDate,
              userId,
              approvedPlan,
            ).pipe(
              Effect.catchAll((error) => {
                if (
                  error instanceof ProductsInfrastructureError &&
                  error.cause !== undefined
                ) {
                  return Effect.fail(error);
                }
                return Effect.sync(() => {
                  pushRowError(result, row.sourceRow, formatImportError(error));
                });
              }),
            );
            processedRows++;
            if (result.errors.length > errorsBeforeRow) {
              failedRows++;
            }
            yield* reportProgress(
              PRODUCT_IMPORT_PROGRESS_MESSAGES.rowsProcessed,
            );
          }

          yield* reportProgress(PRODUCT_IMPORT_PROGRESS_MESSAGES.completed);
          return result;
        }).pipe(Effect.withSpan('ProductImportService.importFromCsvContent'));

      const previewCsvContent = (
        options: AnalyzeProductsFromCsvOptions,
      ): Effect.Effect<
        ProductImportPreviewDto,
        ProductImportCsvParseFailed | ProductImportUnsupportedFormat
      > =>
        Effect.gen(function* () {
          const { parsed, format } = yield* parseAndDetectFormat(options);
          return makeProductImportPreview(parsed.records, format);
        }).pipe(Effect.withSpan('ProductImportService.previewCsvContent'));

      const proposeImportPlan = (
        options: AnalyzeProductsFromCsvOptions,
      ): Effect.Effect<
        ProductImportAiProposalDto,
        ProductImportCsvParseFailed | ProductImportUnsupportedFormat
      > =>
        Effect.gen(function* () {
          const { parsed, format } = yield* parseAndDetectFormat(options);
          const preview = makeProductImportPreview(parsed.records, format);
          return yield* llmProposer.propose(preview);
        }).pipe(Effect.withSpan('ProductImportService.proposeImportPlan'));

      return {
        importFromCsvContent,
        previewCsvContent,
        proposeImportPlan,
      };
    }),
    dependencies: [
      ProductImportRepository.Default,
      ProductImportLlmProposer.Default,
      ProductImportPhotoImporter.Default,
    ],
  },
) {}
