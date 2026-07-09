import { Effect } from 'effect';
import type {
  AnalyzeProductsFromCsvOptions,
  ImportCaches,
  ImportProductRow,
  ImportProductsFromCsvOptions,
  ProductImportAiProposalDto,
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
  ProductImportUnsupportedFormat,
  ProductsInfrastructureError,
} from '../products.errors';
import {
  ProductImportCancelled as ProductImportCancelledError,
  ProductsInfrastructureError as ProductsInfrastructureFailure,
} from '../products.errors';
import { makeServiceTracer } from '../../../platform/observability/service-tracer';
import { ProductImportLlmProposer } from './llm-proposer';
import { ProductImportPhotoImporter } from './photo-importer';
import { ProductImportRepository } from './repository';
import { getSkuConflictPolicy } from './plan';
import { parseAndDetectProductImportFormat } from './parser';
import { importProductRow } from './row/import';

const PROGRESS_ROW_REPORT_INTERVAL = 25;

export class ProductImportService extends Effect.Service<ProductImportService>()(
  '@stocket/effect/products/ProductImportService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* ProductImportRepository;
      const llmProposer = yield* ProductImportLlmProposer;
      const photoImporter = yield* ProductImportPhotoImporter;
      const trace = makeServiceTracer({
        serviceName: 'ProductImportService',
        module: 'products',
        layer: 'service',
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
          const { parsed, format } = yield* parseAndDetectProductImportFormat({
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
            ? hooks.isCancelRequested.pipe(
                Effect.filterOrFail(
                  (canceled) => !canceled,
                  () =>
                    new ProductImportCancelledError({
                      messageKey: 'products.importCancelled',
                    }),
                ),
                Effect.asVoid,
              )
            : Effect.void;
          const shouldReportRowProgress = () =>
            processedRows === rows.length ||
            processedRows % PROGRESS_ROW_REPORT_INTERVAL === 0;
          const reportRowProgress = () =>
            shouldReportRowProgress()
              ? reportProgress(PRODUCT_IMPORT_PROGRESS_MESSAGES.rowsProcessed)
              : Effect.void;
          const skipFailedRow = (sourceRow: number, error: string) =>
            Effect.gen(function* () {
              pushRowError(result, sourceRow, error);
              processedRows++;
              failedRows++;
              yield* reportRowProgress();
            });

          yield* reportProgress(PRODUCT_IMPORT_PROGRESS_MESSAGES.starting);
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
            const derivedSku = derivedSkusByRow.get(originalRow.sourceRow);
            const row = derivedSku
              ? { ...originalRow, sku: derivedSku }
              : originalRow;
            if (!row.sku || !row.name) {
              yield* skipFailedRow(
                row.sourceRow,
                'Cannot import product without sku and name',
              );
              continue;
            }

            if (duplicateConflictRows.has(row.sourceRow) && !derivedSku) {
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
            yield* importProductRow({
              repository,
              photoImporter,
              row,
              caches,
              result,
              expiryDate,
              userId,
              approvedPlan,
            }).pipe(
              Effect.catchAll((error) => {
                if (
                  error instanceof ProductsInfrastructureFailure &&
                  error.cause !== undefined
                ) {
                  return Effect.fail(error);
                }

                return Effect.sync(() => {
                  coreRowFailed = true;
                  pushRowError(result, row.sourceRow, formatImportError(error));
                });
              }),
            );
            processedRows++;
            if (coreRowFailed) {
              failedRows++;
            }
            yield* reportRowProgress();
          }

          yield* reportProgress(PRODUCT_IMPORT_PROGRESS_MESSAGES.completed);
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

      const proposeImportPlan = (
        options: AnalyzeProductsFromCsvOptions,
      ): Effect.Effect<
        ProductImportAiProposalDto,
        ProductImportCsvParseFailed | ProductImportUnsupportedFormat
      > =>
        Effect.gen(function* () {
          const { parsed, format } =
            yield* parseAndDetectProductImportFormat(options);
          const preview = makeProductImportPreview(parsed.records, format);
          return yield* llmProposer.propose(preview);
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
    ],
  },
) {}
