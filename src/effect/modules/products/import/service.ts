import { Cause, Chunk, Effect, Option } from 'effect';
import type {
  AnalyzeProductsFromCsvOptions,
  ImportCaches,
  ImportProductRow,
  ImportProductsFromCsvOptions,
  ProductImportProgress,
  ProductImportPreviewDto,
  ProductImportResultDto,
} from './types';
import { PRODUCT_IMPORT_PROGRESS_MESSAGES } from './types';
import {
  deriveConflictingDuplicateSkuRows,
  findConflictingDuplicateSkuRows,
} from './utils/duplicates';
import {
  formatImportError,
  makeEmptyProductImportResult,
  pushRowError,
} from './utils/result';
import { makeProductImportPreview } from './utils/preview';
import { normalizeProductImportRecords } from './utils/csv';
import { parseDate } from './utils/value-parsers';
import type {
  ProductImportCancelled,
  ProductImportCsvParseFailed,
  ProductImportProposalInvalid,
  ProductImportUnsupportedFormat,
  ProductsInfrastructureError,
} from '../products.errors';
import { ProductImportCancelled as ProductImportCancelledError } from '../products.errors';
import type { TenantNotResolved } from '../../../platform/tenancy/tenant-context';
import { makeServiceTracer } from '../../../platform/observability/service-tracer';
import { ProductImportLlmProposer } from './llm-proposer';
import { ProductImportPhotoImporter } from './photo-importer';
import { ProductImportRepository } from './repository';
import { getPhotoPolicy, getSkuConflictPolicy } from './plan';
import { parseAndDetectProductImportFormat } from './parser';
import { importProductRow } from './row/import';
import { importProductPhotos } from './row/photos';
import { ProductImportPlanningContext } from './planning-context';
import { validateProductImportGuidance } from './guidance';
import { makeProductImportProposal } from './utils/proposal';
import { validateProductImportExecutionPlan } from './execution-plan';

const PROGRESS_ROW_REPORT_INTERVAL = 25;

export class ProductImportService extends Effect.Service<ProductImportService>()(
  '@stocket/effect/products/ProductImportService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* ProductImportRepository;
      const llmProposer = yield* ProductImportLlmProposer;
      const photoImporter = yield* ProductImportPhotoImporter;
      const planningContext = yield* ProductImportPlanningContext;
      const trace = makeServiceTracer({
        serviceName: 'ProductImportService',
        module: 'products',
        layer: 'service',
      });

      const importFromCsvContent = <E>({
        content,
        importType = 'auto',
        approvedPlan,
        userId,
        hooks,
      }: ImportProductsFromCsvOptions<E>): Effect.Effect<
        ProductImportResultDto,
        | E
        | ProductImportCancelled
        | ProductImportCsvParseFailed
        | ProductImportProposalInvalid
        | ProductImportUnsupportedFormat
        | ProductsInfrastructureError
        | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const ensureNotCanceled =
            hooks?.isCancellationRequested === undefined
              ? Effect.void
              : hooks.isCancellationRequested.pipe(
                  Effect.filterOrFail(
                    (canceled) => !canceled,
                    () =>
                      new ProductImportCancelledError({
                        messageKey: 'products.importCancelled',
                      }),
                  ),
                  Effect.asVoid,
                );
          yield* ensureNotCanceled;

          const { parsed, format } = yield* parseAndDetectProductImportFormat({
            content,
            importType,
          });

          const result = makeEmptyProductImportResult();
          const rows = normalizeProductImportRecords(parsed.records, format);
          const photoPolicy = getPhotoPolicy(approvedPlan);
          const rowDecisions = yield* validateProductImportExecutionPlan({
            repository,
            rows,
            format,
            approvedPlan,
          });
          let processedRows = 0;
          let failedRows = 0;
          const reportProgress = (
            messageKey: ProductImportProgress['messageKey'],
            force = false,
          ) =>
            hooks?.onProgress === undefined
              ? Effect.void
              : hooks.onProgress({
                  total: rows.length,
                  processed: processedRows,
                  failed: failedRows,
                  messageKey,
                  force,
                });
          const reportRowProgress = () =>
            processedRows === rows.length ||
            processedRows % PROGRESS_ROW_REPORT_INTERVAL === 0
              ? reportProgress(PRODUCT_IMPORT_PROGRESS_MESSAGES.rowsProcessed)
              : Effect.void;
          const skipFailedRow = (sourceRow: number, error: string) =>
            Effect.gen(function* () {
              pushRowError(result, sourceRow, error);
              processedRows += 1;
              failedRows += 1;
              yield* reportRowProgress();
            });
          const skipApprovedRow = () =>
            Effect.gen(function* () {
              result.rowsSkipped += 1;
              processedRows += 1;
              yield* reportRowProgress();
            });

          yield* reportProgress(
            PRODUCT_IMPORT_PROGRESS_MESSAGES.starting,
            true,
          );
          const duplicateConflictRows = findConflictingDuplicateSkuRows(rows, {
            includeReorderPoint: format === 'normalized-products',
          });
          const derivedSkusByRow =
            getSkuConflictPolicy(approvedPlan) === 'derive-sku'
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
            const rowDecision = rowDecisions.get(originalRow.sourceRow);
            if (rowDecision?.action === 'skip') {
              yield* skipApprovedRow();
              continue;
            }
            const targetSku =
              rowDecision?.targetSku ??
              derivedSkusByRow.get(originalRow.sourceRow);
            const row = targetSku
              ? { ...originalRow, sku: targetSku }
              : originalRow;
            if (!row.sku || !row.name) {
              yield* skipFailedRow(
                row.sourceRow,
                'Cannot import product without sku and name',
              );
              continue;
            }

            if (
              duplicateConflictRows.has(row.sourceRow) &&
              targetSku === undefined
            ) {
              yield* skipFailedRow(
                row.sourceRow,
                `Conflicting duplicate SKU "${row.sku}" has different product fields`,
              );
              continue;
            }

            const expiryDate = parseDate(row.expiry_date);
            if (row.expiry_date.trim() !== '' && expiryDate === null) {
              yield* skipFailedRow(
                row.sourceRow,
                `Invalid expiry_date "${row.expiry_date}"`,
              );
              continue;
            }

            let coreRowFailed = false;
            const rowCaches: ImportCaches = {
              categories: new Map(caches.categories),
              locations: new Map(caches.locations),
              areas: new Map(caches.areas),
              products: new Map(caches.products),
              photoUrlsByProduct: new Map(caches.photoUrlsByProduct),
            };
            const rowResult = makeEmptyProductImportResult();
            const importedProduct = yield* repository
              .runRowTransaction((transactionRepository) =>
                importProductRow({
                  repository: transactionRepository,
                  row,
                  caches: rowCaches,
                  result: rowResult,
                  expiryDate,
                  userId,
                  approvedPlan,
                }),
              )
              .pipe(
                Effect.catchAllCause((cause) => {
                  if (
                    Cause.isDie(cause) ||
                    Cause.isInterrupted(cause) ||
                    Chunk.size(Cause.failures(cause)) !== 1
                  ) {
                    return Effect.failCause(cause);
                  }
                  const failure = Cause.failureOption(cause);
                  if (Option.isNone(failure)) return Effect.failCause(cause);
                  switch (failure.value._tag) {
                    case 'TenantNotResolved':
                      return Effect.fail(failure.value);
                    case 'ProductInfrastructureError':
                      return Effect.sync(() => {
                        coreRowFailed = true;
                        pushRowError(
                          result,
                          row.sourceRow,
                          formatImportError(failure.value),
                        );
                        return null;
                      });
                  }
                }),
              );
            if (importedProduct !== null) {
              for (const [key, value] of rowCaches.categories) {
                caches.categories.set(key, value);
              }
              for (const [key, value] of rowCaches.locations) {
                caches.locations.set(key, value);
              }
              for (const [key, value] of rowCaches.areas) {
                caches.areas.set(key, value);
              }
              for (const [key, value] of rowCaches.products) {
                caches.products.set(key, value);
              }
              result.categoriesCreated += rowResult.categoriesCreated;
              result.locationsCreated += rowResult.locationsCreated;
              result.areasCreated += rowResult.areasCreated;
              result.productsCreated += rowResult.productsCreated;
              result.productsUpdated += rowResult.productsUpdated;
              result.inventoryRecordsCreated +=
                rowResult.inventoryRecordsCreated;
              result.inventoryRecordsUpdated +=
                rowResult.inventoryRecordsUpdated;

              if (photoPolicy === 'skip') {
                result.photosSkipped += row.photo_urls.length;
              } else {
                yield* importProductPhotos(
                  photoImporter,
                  importedProduct,
                  row,
                  caches,
                  result,
                  userId,
                );
              }
            }
            processedRows += 1;
            if (coreRowFailed) failedRows += 1;
            yield* reportRowProgress();
          }

          yield* reportProgress(
            PRODUCT_IMPORT_PROGRESS_MESSAGES.completed,
            true,
          );
          return result;
        }).pipe(trace.span('importFromCsvContent'));

      const previewCsvContent = (
        options: AnalyzeProductsFromCsvOptions,
      ): Effect.Effect<
        ProductImportPreviewDto,
        ProductImportCsvParseFailed | ProductImportUnsupportedFormat
      > =>
        Effect.gen(function* () {
          const { parsed, format } =
            yield* parseAndDetectProductImportFormat(options);
          return makeProductImportPreview(parsed.records, format);
        }).pipe(trace.span('previewCsvContent'));

      const proposeImportPlan = (options: AnalyzeProductsFromCsvOptions) =>
        Effect.gen(function* () {
          const { parsed, format } =
            yield* parseAndDetectProductImportFormat(options);
          const preview = makeProductImportPreview(parsed.records, format);
          const context = yield* planningContext.load();
          const baseline = makeProductImportProposal(preview, context);
          const guidance = yield* validateProductImportGuidance(
            options.guidance,
            baseline,
            context,
          );
          return yield* llmProposer.propose(preview, context, guidance);
        }).pipe(trace.span('proposeImportPlan'));

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
      ProductImportPlanningContext.Default,
    ],
  },
) {}
