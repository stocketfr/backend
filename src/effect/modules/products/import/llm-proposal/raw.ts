import { Schema } from 'effect';

const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(Schema.Number);

const RawCategoryMappingSchema = Schema.Struct({
  sourcePath: Schema.String,
  targetCategoryId: NullableString,
  targetPath: Schema.String,
  action: Schema.Literal('use-existing', 'create', 'default'),
  confidence: Schema.Number,
  reason: NullableString,
  reviewRequired: Schema.Boolean,
});

const RawLocationMappingSchema = Schema.Struct({
  sourceLocation: Schema.String,
  targetLocationId: NullableString,
  targetLocationName: NullableString,
  targetAreaId: NullableString,
  areaPath: NullableString,
  action: Schema.Literal(
    'use-existing',
    'use-existing-area',
    'create-location',
    'create-area',
    'ignore',
  ),
  confidence: Schema.Number,
  reason: NullableString,
  reviewRequired: Schema.Boolean,
});

const RawSkuVariantResolutionSchema = Schema.Struct({
  variantKey: Schema.String,
  action: Schema.Literal('keep-source-sku', 'derive-sku', 'custom-sku', 'skip'),
  targetSku: NullableString,
});

const RawSkuConflictResolutionSchema = Schema.Struct({
  conflictKey: Schema.String,
  confidence: Schema.Number,
  reason: NullableString,
  reviewRequired: Schema.Boolean,
  variants: Schema.Array(RawSkuVariantResolutionSchema),
});

const RawMissingLocationStrategySchema = Schema.Struct({
  action: Schema.Literal(
    'assign-review-area',
    'use-existing-area',
    'skip-inventory',
  ),
  targetLocationId: NullableString,
  targetLocationName: NullableString,
  targetAreaId: NullableString,
  areaPath: NullableString,
  confidence: Schema.Number,
  reason: NullableString,
  reviewRequired: Schema.Boolean,
});

const RawWarningSchema = Schema.Struct({
  row: NullableNumber,
  field: NullableString,
  severity: Schema.Literal('error', 'warning'),
  message: Schema.String,
});

const RawLlmProposalSchema = Schema.Struct({
  format: Schema.Literal('normalized-products', 'sortly-items', 'unknown'),
  confidence: Schema.Number,
  productIdentity: Schema.Struct({
    sourceColumn: Schema.String,
    conflictPolicy: Schema.Literal('reject', 'derive-sku'),
  }),
  skuConflictResolutions: Schema.Array(RawSkuConflictResolutionSchema),
  missingLocationStrategy: RawMissingLocationStrategySchema,
  categoryMappings: Schema.Array(RawCategoryMappingSchema),
  supplierMappings: Schema.Array(Schema.Unknown),
  locationMappings: Schema.Array(RawLocationMappingSchema),
  warnings: Schema.Array(RawWarningSchema),
});

export type RawLlmProposal = Schema.Schema.Type<typeof RawLlmProposalSchema>;

export const decodeRawLlmProposal =
  Schema.decodeUnknownSync(RawLlmProposalSchema);
