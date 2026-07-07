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

export const createStorageLocationParser = (
  format: ProductImportFormat,
): StorageLocationParser => storageLocationParserFactories[format]();

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
