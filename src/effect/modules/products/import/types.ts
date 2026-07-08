import { Schema } from 'effect';
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

const ProductImportFormatSchema = Schema.Literal(
  'normalized-products',
  'sortly-items',
);

const ProductImportSkuConflictPolicySchema = Schema.Literal(
  'reject',
  'derive-sku',
);

const ProductImportWarningSchema = Schema.Struct({
  row: Schema.optional(Schema.Number),
  field: Schema.optional(Schema.String),
  severity: Schema.optionalWith(Schema.Literal('error', 'warning'), {
    default: () => 'warning' as const,
  }),
  message: Schema.String,
});

const ProductImportCategoryMappingSchema = Schema.Struct({
  sourcePath: Schema.String,
  targetCategoryId: Schema.optional(Schema.String),
  targetPath: Schema.String,
  action: Schema.optionalWith(
    Schema.Literal('use-existing', 'create', 'default'),
    { default: () => 'create' as const },
  ),
  rowCount: Schema.optionalWith(Schema.Number, { default: () => 0 }),
});

const ProductImportSupplierMappingSchema = Schema.Struct({
  sourcePattern: Schema.String,
  supplierName: Schema.String,
  targetSupplierId: Schema.optional(Schema.String),
  action: Schema.optionalWith(
    Schema.Literal('use-existing', 'create', 'ignore'),
    { default: () => 'create' as const },
  ),
  confidence: Schema.optionalWith(Schema.Number, { default: () => 1 }),
  rowCount: Schema.optionalWith(Schema.Number, { default: () => 0 }),
});

const ProductImportLocationMappingSchema = Schema.Struct({
  sourceLocation: Schema.String,
  targetLocationId: Schema.optional(Schema.String),
  targetLocationName: Schema.optional(Schema.String),
  areaPath: Schema.optional(Schema.String),
  action: Schema.Literal(
    'use-existing',
    'create-location',
    'create-area',
    'ignore',
  ),
  confidence: Schema.optionalWith(Schema.Number, { default: () => 1 }),
  rowCount: Schema.optionalWith(Schema.Number, { default: () => 0 }),
}).pipe(
  Schema.filter(
    (mapping) =>
      mapping.action !== 'create-area' ||
      (mapping.areaPath !== undefined && mapping.areaPath.trim() !== ''),
  ),
);

export const ProductImportApprovedPlanSchema = Schema.Struct({
  skuConflictPolicy: Schema.optional(ProductImportSkuConflictPolicySchema),
  allowCreateSuppliers: Schema.optional(Schema.Boolean),
  defaultLocationName: Schema.optional(Schema.String),
  categoryMappings: Schema.optional(
    Schema.Array(ProductImportCategoryMappingSchema),
  ),
  supplierMappings: Schema.optional(
    Schema.Array(ProductImportSupplierMappingSchema),
  ),
  locationMappings: Schema.optional(
    Schema.Array(ProductImportLocationMappingSchema),
  ),
});

export const ProductImportAiProposalSchema = Schema.Struct({
  format: Schema.Union(ProductImportFormatSchema, Schema.Literal('unknown')),
  confidence: Schema.Number,
  productIdentity: Schema.Struct({
    sourceColumn: Schema.String,
    conflictPolicy: ProductImportSkuConflictPolicySchema,
  }),
  categoryMappings: Schema.Array(ProductImportCategoryMappingSchema),
  supplierMappings: Schema.Array(ProductImportSupplierMappingSchema),
  locationMappings: Schema.Array(ProductImportLocationMappingSchema),
  warnings: Schema.Array(ProductImportWarningSchema),
});

export const ProductImportPlanSchema = Schema.Union(
  ProductImportAiProposalSchema,
  ProductImportApprovedPlanSchema,
);

export type ProductImportType = (typeof ProductImportTypes)[number];
export type ProductImportFormat = Exclude<ProductImportType, 'auto'>;
export type ProductImportPlan =
  | ProductImportApprovedPlanDto
  | ProductImportAiProposalDto;

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
  readonly approvedPlan?: ProductImportPlan;
  readonly userId: string;
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
