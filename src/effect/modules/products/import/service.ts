import { Effect } from 'effect';
import type {
  AnalyzeProductsFromCsvOptions,
  ImportProductsFromCsvOptions,
  ProductImportAiProposalDto,
  ProductImportPreviewDto,
  ProductImportResultDto,
} from './types';
import {
  detectProductImportFormat,
  deriveConflictingDuplicateSkuRows,
  findConflictingDuplicateSkuRows,
  formatImportError,
  getImportPlanSkuConflictPolicy,
  makeProductImportPreview,
  normalizeProductImportRecords,
  parseCsvContent,
  parseDate,
  pushRowError,
} from './utils';
import {
  ProductImportCsvParseFailed,
  ProductImportUnsupportedFormat,
} from '../products.errors';
import { ProductImportLlmProposer } from './llm-proposer';
import { ProductImportPhotoImporter } from './photo-importer';
import { ProductImportRepository } from './repository';
import { processProductImportRow } from './row-processing';
import { makeImportRunState } from './state';

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
          const { parsed, format } = yield* parseAndDetectFormat({
            content,
            importType,
          });

          const state = makeImportRunState();
          const rows = normalizeProductImportRecords(parsed.records, format);
          const duplicateConflictRows = findConflictingDuplicateSkuRows(rows, {
            includeReorderPoint: format === 'normalized-products',
          });
          const derivedSkusByRow =
            getImportPlanSkuConflictPolicy(approvedPlan) === 'derive-sku'
              ? deriveConflictingDuplicateSkuRows(rows, {
                  includeReorderPoint: format === 'normalized-products',
                })
              : new Map<number, string>();

          for (const originalRow of rows) {
            const derivedSku = derivedSkusByRow.get(originalRow.sourceRow);
            const row = derivedSku
              ? { ...originalRow, sku: derivedSku }
              : originalRow;

            if (!row.sku || !row.name) {
              pushRowError(
                state.result,
                row.sourceRow,
                'Cannot import product without sku and name',
              );
              continue;
            }

            if (duplicateConflictRows.has(row.sourceRow) && !derivedSku) {
              pushRowError(
                state.result,
                row.sourceRow,
                `Conflicting duplicate SKU "${row.sku}" has different product fields`,
              );
              continue;
            }

            const expiryDate = parseDate(row.expiry_date);
            if (row.expiry_date.trim() !== '' && expiryDate === null) {
              pushRowError(
                state.result,
                row.sourceRow,
                `Invalid expiry_date "${row.expiry_date}"`,
              );
              continue;
            }

            yield* processProductImportRow({
              services: { repository, photoImporter },
              row,
              state,
              expiryDate,
              userId,
              approvedPlan,
            }).pipe(
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  pushRowError(
                    state.result,
                    row.sourceRow,
                    formatImportError(error),
                  );
                }),
              ),
            );
          }

          return state.result;
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
