import type {
  StorageLocationAreaPathResult,
  StorageLocationParseResult,
  StorageLocationParser,
  StorageLocationParserSource,
  StorageLocationTargetLocationResult,
} from './types';
import { joinAreaPath, normalizeStorageLocationName } from './utils';

export abstract class StorageLocationParserBase implements StorageLocationParser {
  abstract readonly source: StorageLocationParserSource;

  abstract parse(sourceLocation: string): StorageLocationParseResult;

  protected normalize(sourceLocation: string): string {
    return normalizeStorageLocationName(sourceLocation);
  }

  protected areaPathResult(
    sourceLocation: string,
    segments: readonly string[],
    confidence: number,
  ): StorageLocationAreaPathResult {
    return {
      kind: 'area-path',
      sourceLocation,
      areaPath: joinAreaPath(segments),
      confidence,
    };
  }

  protected locationResult(
    sourceLocation: string,
    confidence: number,
  ): StorageLocationTargetLocationResult {
    return {
      kind: 'location',
      sourceLocation,
      targetLocationName: sourceLocation,
      confidence,
    };
  }
}
