import type {
  ProductImportAiProposalDto,
  ProductImportApprovedPlanDto,
  ProductImportDuplicateSkuConflictDto,
  ProductImportErrorDto,
  ProductImportInventoryPreviewDto,
  ProductImportLocationMappingDto,
  ProductImportPreviewDto,
  ProductImportResultDto,
  ProductImportWarningDto,
} from '@stocket/types/products';
import type { Effect } from 'effect';
import type { areas, categories, locations } from '../../../platform/db/schema';
import type { ProductRow } from '../products.utils';

export type {
  ProductImportAiProposalDto,
  ProductImportApprovedPlanDto,
  ProductImportDuplicateSkuConflictDto,
  ProductImportErrorDto,
  ProductImportInventoryPreviewDto,
  ProductImportLocationMappingDto,
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

export type ImportCategoryRow = typeof categories.$inferSelect;
export type ImportLocationRow = typeof locations.$inferSelect;
export type ImportAreaRow = typeof areas.$inferSelect;
export type ImportProductRow = ProductRow;

export interface ImportCaches {
  readonly categories: Map<string, string>;
  readonly locations: Map<string, string>;
  readonly areas: Map<string, string>;
  readonly products: Map<string, ImportProductRow>;
  readonly photoUrlsByProduct: Map<string, Set<string>>;
}

export interface ImportProductsFromCsvOptions {
  readonly content: string;
  readonly importType?: ProductImportType;
  readonly approvedPlan?: ProductImportApprovedPlanDto;
  readonly userId: string;
  readonly hooks?: ProductImportExecutionHooks;
}

export interface AnalyzeProductsFromCsvOptions {
  readonly content: string;
  readonly importType?: ProductImportType;
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

export interface ProductImportProgress {
  readonly total: number;
  readonly processed: number;
  readonly failed: number;
  readonly message?: string | null;
}

export interface ProductImportExecutionHooks {
  readonly onProgress?: (
    progress: ProductImportProgress,
  ) => Effect.Effect<void, never, never>;
  readonly isCancelRequested?: Effect.Effect<boolean, never, never>;
}
