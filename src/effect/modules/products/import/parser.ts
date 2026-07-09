import { Effect } from 'effect';
import type {
  AnalyzeProductsFromCsvOptions,
  CsvParseResult,
  ProductImportFormat,
} from './types';
import {
  detectProductImportFormat,
  parseCsvContent,
} from './utils/csv';
import {
  ProductImportCsvParseFailed,
  ProductImportUnsupportedFormat,
} from '../products.errors';

export interface ParsedProductImport {
  readonly parsed: CsvParseResult;
  readonly format: ProductImportFormat;
}

export const parseAndDetectProductImportFormat = ({
  content,
  importType = 'auto',
}: AnalyzeProductsFromCsvOptions): Effect.Effect<
  ParsedProductImport,
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
    return { parsed, format };
  });
