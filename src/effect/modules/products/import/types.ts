import type {
  ProductImportAiProposalDto,
  ProductImportApprovedPlanDto,
  ProductImportErrorDto,
  ProductImportPreviewDto,
  ProductImportResultDto,
} from '@stocket/types/products';
import type {
  areas,
  categories,
  locations,
  suppliers,
} from '../../../platform/db/schema';
import type { ProductRow } from '../products.utils';

export type {
  ProductImportAiProposalDto,
  ProductImportApprovedPlanDto,
  ProductImportErrorDto,
  ProductImportPreviewDto,
  ProductImportResultDto,
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
  readonly unit: string;
  readonly standard_price: string;
  readonly barcode: string;
  readonly description: string;
  readonly notes: string;
  readonly supplier_name: string;
  readonly supplier_sku: string;
  readonly supplier_cost: string;
  readonly area_path: string;
  readonly is_active: string;
  readonly is_perishable: string;
  readonly expiry_date: string;
}

export interface DuplicateSkuConflict {
  readonly sku: string;
  readonly rows: readonly number[];
  readonly names: readonly string[];
}

export type ImportCategoryRow = typeof categories.$inferSelect;
export type ImportLocationRow = typeof locations.$inferSelect;
export type ImportAreaRow = typeof areas.$inferSelect;
export type ImportSupplierRow = typeof suppliers.$inferSelect;
export type ImportProductRow = ProductRow;

export interface ImportCaches {
  readonly categories: Map<string, string>;
  readonly locations: Map<string, string>;
  readonly areas: Map<string, string>;
  readonly suppliers: Map<string, string | null>;
  readonly products: Map<string, ImportProductRow>;
}

export interface ImportProductsFromCsvOptions {
  readonly content: string;
  readonly importType?: ProductImportType;
  readonly userId: string;
  readonly approvedPlan?: ProductImportApprovedPlanDto;
  readonly allowCreateSuppliers?: boolean;
}

export interface ProductImportValues {
  readonly name: string;
  readonly description: string | null;
  readonly category_id: string;
  readonly standard_cost: number | null;
  readonly unit: string | null;
  readonly barcode: string | null;
  readonly standard_price: number | null;
  readonly reorder_point: number;
  readonly primary_supplier_id: string | null;
  readonly supplier_sku: string | null;
  readonly is_active: boolean;
  readonly is_perishable: boolean;
  readonly notes: string | null;
}

export interface PreviewProductRowsOptions {
  readonly content: string;
  readonly importType?: ProductImportType;
}

export interface ProposeProductImportPlanOptions {
  readonly content: string;
  readonly importType?: ProductImportType;
}
