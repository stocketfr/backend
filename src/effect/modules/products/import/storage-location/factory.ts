import type { ProductImportFormat } from '../types';
import { NormalizedProductsStorageLocationParser } from './normalized-products';
import { SortlyStorageLocationParser } from './sortly';
import type {
  StorageLocationMappingSuggestion,
  StorageLocationParser,
  StorageLocationParserFactory,
} from './types';

const storageLocationParserFactories = {
  'normalized-products': () => new NormalizedProductsStorageLocationParser(),
  'sortly-items': () => new SortlyStorageLocationParser(),
} satisfies Record<ProductImportFormat, StorageLocationParserFactory>;

const storageLocationParsers = new Map<
  ProductImportFormat,
  StorageLocationParser
>();

export const createStorageLocationParser = (
  format: ProductImportFormat,
): StorageLocationParser => {
  const cached = storageLocationParsers.get(format);
  if (cached) return cached;

  const parser = storageLocationParserFactories[format]();
  storageLocationParsers.set(format, parser);
  return parser;
};

export const suggestLocationMapping = (
  sourceLocation: string,
  format: ProductImportFormat,
): StorageLocationMappingSuggestion => {
  const parsed = createStorageLocationParser(format).parse(sourceLocation);
  if (parsed.kind === 'area-path') {
    return {
      sourceLocation: parsed.sourceLocation,
      areaPath: parsed.areaPath,
      action: 'create-area',
      confidence: parsed.confidence,
    };
  }

  return {
    sourceLocation: parsed.sourceLocation,
    targetLocationName: parsed.targetLocationName,
    action: 'create-location',
    confidence: parsed.confidence,
  };
};
