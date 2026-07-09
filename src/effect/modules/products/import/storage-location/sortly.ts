import { StorageLocationParserBase } from './base';
import type {
  StorageLocationParserSource,
  StorageLocationParseResult,
} from './types';
import { parseLabeledStorageLocationSegments } from './utils';

const sortlyLocationLabels = [
  { keyword: 'Bay', displayName: 'Bay' },
  { keyword: 'Shelf', displayName: 'Shelf' },
  { keyword: 'Rack', displayName: 'Rack' },
  { keyword: 'Bin', displayName: 'Bin' },
  { keyword: 'Drawer', displayName: 'Drawer' },
  { keyword: 'Room', displayName: 'Room' },
  { keyword: 'Cabinet', displayName: 'Cabinet' },
] as const;

export class SortlyStorageLocationParser extends StorageLocationParserBase {
  readonly source: StorageLocationParserSource = 'sortly-items';

  parse(sourceLocation: string): StorageLocationParseResult {
    const normalized = this.normalize(sourceLocation);
    const segments = parseLabeledStorageLocationSegments(normalized, {
      separatorPattern: /\s+-\s+|\s*\/\s*/g,
      labels: sortlyLocationLabels,
    });

    if (segments.length >= 2) {
      return this.areaPathResult(normalized, segments, 0.9);
    }

    return this.locationResult(normalized, 0.65);
  }
}
