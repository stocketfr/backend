import type {
  ProductImportCommitResultDto,
  ProductImportErrorDto,
  ProductImportMappingDto,
  ProductImportPreviewDto,
  ProductImportResultDto,
  ProductImportWarningDto,
} from '@stocket/types/products';
import type { areas, categories, locations } from '../../../platform/db/schema';
import type { ProductRow } from '../products.utils';

export type {
  ProductImportCommitResultDto,
  ProductImportErrorDto,
  ProductImportMappingDto,
  ProductImportPreviewDto,
  ProductImportResultDto,
  ProductImportWarningDto,
};

export const ProductImportTypes = [
  'auto',
  'normalized-products',
  'sortly-items',
] as const;

export type ProductImportType = (typeof ProductImportTypes)[number];
export type ProductImportFormat = Exclude<ProductImportType, 'auto'>;

export interface CsvParseResult {
  readonly headers: readonly string[];
  readonly records: readonly CsvRecord[];
}

export type CsvRecord = Record<string, unknown>;

export interface NormalizedProductImportRow {
  readonly sourceRow: number;
  readonly sku: string;
  readonly name: string;
  readonly category_path: string;
  readonly reorder_point: string;
  readonly quantity: string;
  readonly location: string;
  readonly area_path: string;
  readonly unit: string;
  readonly standard_price: string;
  readonly barcode: string;
  readonly description: string;
  readonly notes: string;
  readonly is_active: string;
  readonly is_perishable: string;
  readonly expiry_date: string;
  readonly photo_urls: readonly string[];
}

export type ImportAreaRow = typeof areas.$inferSelect;
export type ImportCategoryRow = typeof categories.$inferSelect;
export type ImportLocationRow = typeof locations.$inferSelect;
export type ImportProductRow = ProductRow;

export interface ImportCaches {
  readonly areas: Map<string, string>;
  readonly categories: Map<string, string>;
  readonly locations: Map<string, string>;
  readonly products: Map<string, ImportProductRow>;
}

export interface ImportProductsFromCsvOptions {
  readonly content: string;
  readonly importType?: ProductImportType;
  readonly mapping?: ProductImportMappingDto;
  readonly importPhotos?: boolean;
  readonly userId: string;
}

export interface PreviewProductsFromCsvOptions {
  readonly content: string;
  readonly importType?: ProductImportType;
  readonly knownLocations?: readonly string[];
  readonly useLlm?: boolean;
}

export interface ProductImportValues {
  readonly name: string;
  readonly description: string | null;
  readonly category_id: string;
  readonly unit: string | null;
  readonly barcode: string | null;
  readonly standard_price: number | null;
  readonly reorder_point: number;
  readonly is_active: boolean;
  readonly is_perishable: boolean;
  readonly notes: string | null;
}
