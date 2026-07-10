import { Schema, type Effect } from 'effect';
import type { MessageKey } from '../../../platform/catalogs';
import type {
  ProductImportAiProposalDto,
  ProductImportAiProposalV2Dto,
  ProductImportApprovedPlanDto,
  ProductImportApprovedPlanV2Dto,
  ProductImportDuplicateSkuConflictDto,
  ProductImportErrorDto,
  ProductImportInventoryPreviewDto,
  ProductImportLocationMappingDto,
  ProductImportPlanDto,
  ProductImportPreviewDto,
  ProductImportProposalGuidanceDto,
  ProductImportResultDto,
  ProductImportTargetContextDto,
  ProductImportWarningDto,
} from '@stocket/types/products';
import type {
  areas,
  categories,
  inventory,
  locations,
} from '../../../platform/db/schema';
import type { ProductRow } from '../types';

export type {
  ProductImportAiProposalDto,
  ProductImportAiProposalV2Dto,
  ProductImportApprovedPlanDto,
  ProductImportApprovedPlanV2Dto,
  ProductImportDuplicateSkuConflictDto,
  ProductImportErrorDto,
  ProductImportInventoryPreviewDto,
  ProductImportLocationMappingDto,
  ProductImportPlanDto,
  ProductImportPreviewDto,
  ProductImportProposalGuidanceDto,
  ProductImportResultDto,
  ProductImportTargetContextDto,
  ProductImportWarningDto,
};

export const ProductImportTypes = [
  'auto',
  'normalized-products',
  'sortly-items',
] as const;

export const PRODUCT_IMPORT_PROGRESS_MESSAGES = {
  queued: 'products.importProgressQueued',
  starting: 'products.importProgressStarting',
  rowsProcessed: 'products.importProgressRowsProcessed',
  completed: 'products.importProgressCompleted',
} as const satisfies Record<string, MessageKey>;

export type ProductImportProgressMessageKey =
  (typeof PRODUCT_IMPORT_PROGRESS_MESSAGES)[keyof typeof PRODUCT_IMPORT_PROGRESS_MESSAGES];

const ProductImportFormatSchema = Schema.Literal(
  'normalized-products',
  'sortly-items',
);

const ProductImportSkuConflictPolicySchema = Schema.Literal(
  'reject',
  'derive-sku',
);

const ProductImportDecisionMetadataFields = {
  mappingKey: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
  reviewRequired: Schema.optional(Schema.Boolean),
};

const ProductImportDecisionMetadataV2Fields = {
  mappingKey: Schema.Trim.pipe(Schema.nonEmptyString()),
  confidence: Schema.Number.pipe(
    Schema.filter((value) => value >= 0 && value <= 1),
  ),
  reason: Schema.optional(Schema.String),
  reviewRequired: Schema.Boolean,
};

const ProductImportWarningSchema = Schema.Struct({
  row: Schema.optional(Schema.Number),
  field: Schema.optional(Schema.String),
  severity: Schema.optionalWith(Schema.Literal('error', 'warning'), {
    default: () => 'warning' as const,
  }),
  message: Schema.String,
});

const ProductImportCategoryMappingSchema = Schema.Struct({
  ...ProductImportDecisionMetadataFields,
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
  ...ProductImportDecisionMetadataFields,
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
  ...ProductImportDecisionMetadataFields,
  sourceLocation: Schema.String,
  targetLocationId: Schema.optional(Schema.String),
  targetAreaId: Schema.optional(Schema.String),
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

const ProductImportCategoryMappingV2BaseFields = {
  ...ProductImportDecisionMetadataV2Fields,
  sourcePath: Schema.String,
  targetPath: Schema.String,
  rowCount: Schema.Number,
};

const ProductImportCategoryMappingV2Schema = Schema.Union(
  Schema.Struct({
    ...ProductImportCategoryMappingV2BaseFields,
    action: Schema.Literal('use-existing'),
    targetCategoryId: Schema.String,
  }),
  Schema.Struct({
    ...ProductImportCategoryMappingV2BaseFields,
    action: Schema.Literal('create', 'default'),
  }),
);

const ProductImportLocationMappingV2BaseFields = {
  ...ProductImportDecisionMetadataV2Fields,
  sourceLocation: Schema.String,
  rowCount: Schema.Number,
};

const ProductImportLocationMappingV2Schema = Schema.Union(
  Schema.Struct({
    ...ProductImportLocationMappingV2BaseFields,
    action: Schema.Literal('use-existing'),
    targetLocationId: Schema.String,
    targetLocationName: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...ProductImportLocationMappingV2BaseFields,
    action: Schema.Literal('use-existing-area'),
    targetLocationId: Schema.String,
    targetLocationName: Schema.optional(Schema.String),
    targetAreaId: Schema.String,
    areaPath: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...ProductImportLocationMappingV2BaseFields,
    action: Schema.Literal('create-location'),
    targetLocationName: Schema.String,
  }),
  Schema.Struct({
    ...ProductImportLocationMappingV2BaseFields,
    action: Schema.Literal('create-area'),
    targetLocationId: Schema.String,
    areaPath: Schema.String,
  }),
  Schema.Struct({
    ...ProductImportLocationMappingV2BaseFields,
    action: Schema.Literal('create-area'),
    targetLocationName: Schema.String,
    areaPath: Schema.String,
  }),
  Schema.Struct({
    ...ProductImportLocationMappingV2BaseFields,
    action: Schema.Literal('ignore'),
  }),
);

const ProductImportSkuVariantResolutionSchema = Schema.Union(
  Schema.Struct({
    variantKey: Schema.String,
    rows: Schema.Array(Schema.Number),
    action: Schema.Literal('keep-source-sku', 'derive-sku', 'custom-sku'),
    targetSku: Schema.String,
  }),
  Schema.Struct({
    variantKey: Schema.String,
    rows: Schema.Array(Schema.Number),
    action: Schema.Literal('skip'),
  }),
);

const ProductImportSkuConflictResolutionV2Schema = Schema.Struct({
  ...ProductImportDecisionMetadataV2Fields,
  conflictKey: Schema.String,
  sourceSku: Schema.String,
  variants: Schema.Array(ProductImportSkuVariantResolutionSchema),
});

const ProductImportSkuConflictResolutionSchema = Schema.Struct({
  ...ProductImportDecisionMetadataFields,
  conflictKey: Schema.String,
  sourceSku: Schema.String,
  variants: Schema.Array(ProductImportSkuVariantResolutionSchema),
});

const ProductImportMissingLocationStrategyV2Schema = Schema.Union(
  Schema.Struct({
    ...ProductImportDecisionMetadataV2Fields,
    rowCount: Schema.Number,
    action: Schema.Literal('assign-review-area'),
    targetLocationId: Schema.String,
    areaPath: Schema.String,
  }),
  Schema.Struct({
    ...ProductImportDecisionMetadataV2Fields,
    rowCount: Schema.Number,
    action: Schema.Literal('assign-review-area'),
    targetLocationName: Schema.String,
    areaPath: Schema.String,
  }),
  Schema.Struct({
    ...ProductImportDecisionMetadataV2Fields,
    rowCount: Schema.Number,
    action: Schema.Literal('use-existing-area'),
    targetLocationId: Schema.String,
    targetLocationName: Schema.optional(Schema.String),
    targetAreaId: Schema.String,
    areaPath: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...ProductImportDecisionMetadataV2Fields,
    rowCount: Schema.Number,
    action: Schema.Literal('skip-inventory'),
  }),
);

const ProductImportMissingLocationStrategySchema = Schema.Union(
  Schema.Struct({
    ...ProductImportDecisionMetadataFields,
    rowCount: Schema.Number,
    action: Schema.Literal('assign-review-area'),
    targetLocationId: Schema.String,
    areaPath: Schema.String,
  }),
  Schema.Struct({
    ...ProductImportDecisionMetadataFields,
    rowCount: Schema.Number,
    action: Schema.Literal('assign-review-area'),
    targetLocationName: Schema.String,
    areaPath: Schema.String,
  }),
  Schema.Struct({
    ...ProductImportDecisionMetadataFields,
    rowCount: Schema.Number,
    action: Schema.Literal('use-existing-area'),
    targetLocationId: Schema.String,
    targetLocationName: Schema.optional(Schema.String),
    targetAreaId: Schema.String,
    areaPath: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...ProductImportDecisionMetadataFields,
    rowCount: Schema.Number,
    action: Schema.Literal('skip-inventory'),
  }),
);

export const ProductImportApprovedPlanSchema = Schema.Struct({
  planVersion: Schema.optional(Schema.Undefined),
  skuConflictPolicy: Schema.optional(ProductImportSkuConflictPolicySchema),
  skuConflictResolutions: Schema.optional(
    Schema.Array(ProductImportSkuConflictResolutionSchema),
  ),
  missingLocationStrategy: Schema.optional(
    ProductImportMissingLocationStrategySchema,
  ),
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

export const ProductImportApprovedPlanV2Schema = Schema.Struct({
  planVersion: Schema.Literal(2),
  skuConflictPolicy: ProductImportSkuConflictPolicySchema,
  skuConflictResolutions: Schema.Array(
    ProductImportSkuConflictResolutionV2Schema,
  ),
  missingLocationStrategy: ProductImportMissingLocationStrategyV2Schema,
  allowCreateSuppliers: Schema.optional(Schema.Boolean),
  defaultLocationName: Schema.optional(Schema.String),
  categoryMappings: Schema.Array(ProductImportCategoryMappingV2Schema),
  supplierMappings: Schema.optional(
    Schema.Array(ProductImportSupplierMappingSchema),
  ),
  locationMappings: Schema.Array(ProductImportLocationMappingV2Schema),
});

const ProductImportLockedDecisionKeysSchema = Schema.Struct({
  skuConflictPolicy: Schema.optional(Schema.Boolean),
  missingLocationStrategy: Schema.optional(Schema.Boolean),
  categoryMappings: Schema.optional(Schema.Array(Schema.String)),
  locationMappings: Schema.optional(Schema.Array(Schema.String)),
  skuConflictResolutions: Schema.optional(Schema.Array(Schema.String)),
});

const countGuidanceLocks = (
  locks: Schema.Schema.Type<typeof ProductImportLockedDecisionKeysSchema>,
) =>
  (locks.skuConflictPolicy ? 1 : 0) +
  (locks.missingLocationStrategy ? 1 : 0) +
  (locks.categoryMappings?.length ?? 0) +
  (locks.locationMappings?.length ?? 0) +
  (locks.skuConflictResolutions?.length ?? 0);

export const ProductImportProposalGuidanceSchema = Schema.Struct({
  instructions: Schema.optional(
    Schema.Trim.pipe(Schema.nonEmptyString(), Schema.maxLength(4_000)),
  ),
  currentPlan: Schema.optional(
    Schema.Union(
      ProductImportApprovedPlanV2Schema,
      ProductImportApprovedPlanSchema,
    ),
  ),
  locks: Schema.optional(ProductImportLockedDecisionKeysSchema),
}).pipe(
  Schema.filter(
    (guidance) =>
      guidance.locks === undefined || countGuidanceLocks(guidance.locks) <= 500,
  ),
);

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
export type ImportInventoryRow = typeof inventory.$inferSelect;
export type ImportProductRow = ProductRow;

export interface ImportCaches {
  readonly categories: Map<string, string>;
  readonly locations: Map<string, string>;
  readonly areas: Map<string, string>;
  readonly products: Map<string, ImportProductRow>;
  readonly photoUrlsByProduct: Map<string, Set<string>>;
}

export interface ImportProductsFromCsvOptions<E = never> {
  readonly content: string;
  readonly importType?: ProductImportType;
  readonly approvedPlan?: ProductImportPlan;
  readonly userId: string;
  readonly hooks?: ProductImportExecutionHooks<E>;
}

export interface AnalyzeProductsFromCsvOptions {
  readonly content: string;
  readonly importType?: ProductImportType;
  readonly guidance?: ProductImportProposalGuidanceDto;
}

export interface ProductImportProgress {
  readonly total: number;
  readonly processed: number;
  readonly failed: number;
  readonly messageKey: ProductImportProgressMessageKey;
  readonly force?: boolean;
}

export interface ProductImportExecutionHooks<E = never> {
  readonly onProgress?: (
    progress: ProductImportProgress,
  ) => Effect.Effect<void, E>;
  readonly isCancellationRequested?: Effect.Effect<boolean, E>;
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
