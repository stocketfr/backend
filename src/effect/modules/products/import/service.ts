import { Effect } from 'effect';
import type {
  AnalyzeProductsFromCsvOptions,
  ImportCaches,
  ImportProductRow,
  ImportProductsFromCsvOptions,
  ProductImportAiProposalDto,
  ProductImportPreviewDto,
  ProductImportResultDto,
} from './types';
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
  ProductImportCsvParseFailed,
  ProductImportUnsupportedFormat,
} from '../products.errors';
import { makeServiceTracer } from '../../../platform/observability/service-tracer';
import { ProductImportLlmProposer } from './llm-proposer';
import { ProductImportPhotoImporter } from './photo-importer';
import { ProductImportRepository } from './repository';
import { getSkuConflictPolicy } from './plan';
import { parseAndDetectProductImportFormat } from './parser';
import { importProductRow } from './row/import';

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
      }: ImportProductsFromCsvOptions): Effect.Effect<
        ProductImportResultDto,
        ProductImportCsvParseFailed | ProductImportUnsupportedFormat
      > =>
        Effect.gen(function* () {
          const { parsed, format } = yield* parseAndDetectProductImportFormat({
            content,
            importType,
          });

          const result = makeEmptyProductImportResult();
          const rows = normalizeProductImportRecords(parsed.records, format);
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
              continue;
            }

            if (duplicateConflictRows.has(row.sourceRow) && !derivedSku) {
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
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  pushRowError(result, row.sourceRow, formatImportError(error));
                }),
              ),
            );
          }

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
