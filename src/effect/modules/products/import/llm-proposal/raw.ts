import { Effect, Schema } from 'effect';

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

export const RawLlmProposalSchema = Schema.Struct({
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

const OpenAiResponseContentSchema = Schema.Struct({
  text: Schema.optional(Schema.String),
});

const OpenAiResponseOutputSchema = Schema.Struct({
  content: Schema.optional(Schema.Array(OpenAiResponseContentSchema)),
});

const OpenAiResponseEnvelopeSchema = Schema.Struct({
  output_text: Schema.optional(Schema.NullOr(Schema.String)),
  output: Schema.optional(Schema.Array(OpenAiResponseOutputSchema)),
});

type OpenAiResponseEnvelope = Schema.Schema.Type<
  typeof OpenAiResponseEnvelopeSchema
>;

const proposalText = (envelope: OpenAiResponseEnvelope) => {
  if (envelope.output_text?.trim()) return envelope.output_text;
  for (const output of envelope.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.text?.trim()) return content.text;
    }
  }
  return undefined;
};

const decodeOpenAiResponseEnvelope = Schema.decodeUnknown(
  OpenAiResponseEnvelopeSchema,
);
const decodeRawLlmProposalJson = Schema.decodeUnknown(
  Schema.parseJson(RawLlmProposalSchema),
);

export const decodeRawLlmProposal = Schema.decodeUnknown(RawLlmProposalSchema);

export const decodeOpenAiProposalResponse = (input: unknown) =>
  Effect.gen(function* () {
    const envelope = yield* decodeOpenAiResponseEnvelope(input);
    const text = yield* Effect.fromNullable(proposalText(envelope)).pipe(
      Effect.mapError(
        () => new Error('OpenAI response did not include output text'),
      ),
    );
    return yield* decodeRawLlmProposalJson(text);
  });
