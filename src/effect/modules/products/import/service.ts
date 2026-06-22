import { Effect } from 'effect';
import type {
  ImportCaches,
  ImportProductRow,
  ImportProductsFromCsvOptions,
  NormalizedProductImportRow,
  PreviewProductsFromCsvOptions,
  ProductImportCommitResultDto,
  ProductImportPreviewDto,
} from './types';
import {
  applyProductImportMapping,
  findConflictingDuplicateSkuRows,
  formatImportError,
  importProductImportRow,
  makeEmptyProductImportCommitResult,
  makeProductImportMappingLookups,
  makeProductImportPreview,
  normalizeProductImportRecords,
  parseDate,
  parseProductImportRequest,
  pushRowError,
} from './utils';
import type {
  ProductImportCsvParseFailed,
  ProductImportUnsupportedFormat,
} from '../products.errors';
import { ProductImportRepository } from './repository';
import { PhotosService as PhotosServiceTag } from '../../photos/service';

export class ProductImportService extends Effect.Service<ProductImportService>()(
  '@stocket/effect/products/ProductImportService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* ProductImportRepository;
      const photosService = yield* PhotosServiceTag;

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
          const { parsed, format } = yield* parseProductImportRequest(
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
          const { parsed, format } = yield* parseProductImportRequest(
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

            yield* importProductImportRow({
              repository,
              photosService,
              row,
              caches,
              result,
              expiryDate,
              userId,
              importedPhotoProducts,
              importPhotos,
            }).pipe(
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
    dependencies: [ProductImportRepository.Default, PhotosServiceTag.Default],
  },
) {}
