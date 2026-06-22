import type {
  ProductImportErrorDto,
  ProductImportResultDto,
} from '@stocket/types/products';
import type { categories, locations } from '../../../platform/db/schema';
import type { ProductRow } from '../products.utils';

export type { ProductImportErrorDto, ProductImportResultDto };

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
  readonly unit: string;
  readonly standard_price: string;
  readonly barcode: string;
  readonly description: string;
  readonly notes: string;
  readonly is_active: string;
  readonly is_perishable: string;
  readonly expiry_date: string;
}

export type ImportCategoryRow = typeof categories.$inferSelect;
export type ImportLocationRow = typeof locations.$inferSelect;
export type ImportProductRow = ProductRow;

export interface ImportCaches {
  readonly categories: Map<string, string>;
  readonly locations: Map<string, string>;
  readonly products: Map<string, ImportProductRow>;
}

export interface ImportProductsFromCsvOptions {
  readonly content: string;
  readonly importType?: ProductImportType;
  readonly userId: string;
}

export interface ValidateProductImportCsvOptions {
  readonly content: string;
  readonly importType?: ProductImportType;
  readonly requireRows?: boolean;
}

export interface ValidatedProductImportCsv {
  readonly format: ProductImportFormat;
  readonly rows: readonly NormalizedProductImportRow[];
  readonly validRows: readonly NormalizedProductImportRow[];
  readonly result: ProductImportResultDto;
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
