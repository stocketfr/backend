import { StorageLocationParserBase } from './base';
import type {
  StorageLocationParserSource,
  StorageLocationParseResult,
} from './types';

export class NormalizedProductsStorageLocationParser extends StorageLocationParserBase {
  readonly source: StorageLocationParserSource = 'normalized-products';

  parse(sourceLocation: string): StorageLocationParseResult {
    return this.locationResult(this.normalize(sourceLocation), 0.65);
  }
}
