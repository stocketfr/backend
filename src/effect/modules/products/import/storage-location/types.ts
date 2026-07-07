import type {
  ProductImportFormat,
  ProductImportLocationMappingDto,
} from '../types';

export type StorageLocationParserSource = ProductImportFormat;

export interface StorageLocationAreaPathResult {
  readonly kind: 'area-path';
  readonly sourceLocation: string;
  readonly areaPath: string;
  readonly confidence: number;
}

export interface StorageLocationTargetLocationResult {
  readonly kind: 'location';
  readonly sourceLocation: string;
  readonly targetLocationName: string;
  readonly confidence: number;
}

export type StorageLocationParseResult =
  | StorageLocationAreaPathResult
  | StorageLocationTargetLocationResult;

export interface StorageLocationParser {
  readonly source: StorageLocationParserSource;
  parse(sourceLocation: string): StorageLocationParseResult;
}

export type StorageLocationParserFactory = () => StorageLocationParser;

export interface StorageLocationSegmentLabel {
  readonly keyword: string;
  readonly displayName: string;
}

export interface LabeledStorageLocationParseOptions {
  readonly separatorPattern: RegExp;
  readonly labels: readonly StorageLocationSegmentLabel[];
}

export type StorageLocationMappingSuggestion = Omit<
  ProductImportLocationMappingDto,
  'rowCount'
>;
