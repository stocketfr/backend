import { Schema } from 'effect';
import { isUnknownRecord } from './shared';

const LenientString = Schema.transform(Schema.Unknown, Schema.String, {
  decode: (value: unknown) => (typeof value === 'string' ? value.trim() : ''),
  encode: (value) => value,
});

const LenientFiniteNumber = Schema.transform(
  Schema.Unknown,
  Schema.UndefinedOr(Schema.Number),
  {
    decode: (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined,
    encode: (value) => value,
  },
);

const LenientNonNegativeInteger = Schema.transform(
  Schema.Unknown,
  Schema.UndefinedOr(Schema.Number),
  {
    decode: (value: unknown) =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0
        ? value
        : undefined,
    encode: (value) => value,
  },
);

const LenientFormat = Schema.transform(
  Schema.Unknown,
  Schema.UndefinedOr(Schema.Literal('normalized-products', 'sortly-items')),
  {
    decode: (value: unknown) =>
      value === 'normalized-products' || value === 'sortly-items'
        ? value
        : undefined,
    encode: (value) => value,
  },
);

const LenientSkuConflictPolicy = Schema.transform(
  Schema.Unknown,
  Schema.UndefinedOr(Schema.Literal('reject', 'derive-sku')),
  {
    decode: (value: unknown) =>
      value === 'reject' || value === 'derive-sku' ? value : undefined,
    encode: (value) => value,
  },
);

const LenientCategoryAction = Schema.transform(
  Schema.Unknown,
  Schema.UndefinedOr(Schema.Literal('use-existing', 'create', 'default')),
  {
    decode: (value: unknown) =>
      value === 'use-existing' || value === 'create' || value === 'default'
        ? value
        : undefined,
    encode: (value) => value,
  },
);

const LenientSupplierAction = Schema.transform(
  Schema.Unknown,
  Schema.UndefinedOr(Schema.Literal('use-existing', 'create', 'ignore')),
  {
    decode: (value: unknown) =>
      value === 'use-existing' || value === 'create' || value === 'ignore'
        ? value
        : undefined,
    encode: (value) => value,
  },
);

const LenientLocationAction = Schema.transform(
  Schema.Unknown,
  Schema.UndefinedOr(
    Schema.Literal('use-existing', 'create-location', 'create-area', 'ignore'),
  ),
  {
    decode: (value: unknown) =>
      value === 'use-existing' ||
      value === 'create-location' ||
      value === 'create-area' ||
      value === 'ignore'
        ? value
        : undefined,
    encode: (value) => value,
  },
);

const LenientWarningSeverity = Schema.transform(
  Schema.Unknown,
  Schema.UndefinedOr(Schema.Literal('error', 'warning')),
  {
    decode: (value: unknown) =>
      value === 'error' || value === 'warning' ? value : undefined,
    encode: (value) => value,
  },
);

const RawProductIdentitySchema = Schema.Struct({
  sourceColumn: Schema.optionalWith(LenientString, { default: () => '' }),
  conflictPolicy: Schema.optionalWith(LenientSkuConflictPolicy, {
    default: () => undefined,
  }),
});

const RawCategoryMappingSchema = Schema.Struct({
  sourcePath: Schema.optionalWith(LenientString, { default: () => '' }),
  targetPath: Schema.optionalWith(LenientString, { default: () => '' }),
  action: Schema.optionalWith(LenientCategoryAction, {
    default: () => undefined,
  }),
  rowCount: Schema.optionalWith(LenientNonNegativeInteger, {
    default: () => undefined,
  }),
});

const RawSupplierMappingSchema = Schema.Struct({
  sourcePattern: Schema.optionalWith(LenientString, { default: () => '' }),
  supplierName: Schema.optionalWith(LenientString, { default: () => '' }),
  action: Schema.optionalWith(LenientSupplierAction, {
    default: () => undefined,
  }),
  confidence: Schema.optionalWith(LenientFiniteNumber, {
    default: () => undefined,
  }),
  rowCount: Schema.optionalWith(LenientNonNegativeInteger, {
    default: () => undefined,
  }),
});

const RawLocationMappingSchema = Schema.Struct({
  sourceLocation: Schema.optionalWith(LenientString, { default: () => '' }),
  targetLocationName: Schema.optionalWith(LenientString, { default: () => '' }),
  areaPath: Schema.optionalWith(LenientString, { default: () => '' }),
  action: Schema.optionalWith(LenientLocationAction, {
    default: () => undefined,
  }),
  confidence: Schema.optionalWith(LenientFiniteNumber, {
    default: () => undefined,
  }),
  rowCount: Schema.optionalWith(LenientNonNegativeInteger, {
    default: () => undefined,
  }),
});

const RawWarningSchema = Schema.Struct({
  row: Schema.optionalWith(LenientNonNegativeInteger, {
    default: () => undefined,
  }),
  field: Schema.optionalWith(LenientString, { default: () => '' }),
  severity: Schema.optionalWith(LenientWarningSeverity, {
    default: () => undefined,
  }),
  message: Schema.optionalWith(LenientString, { default: () => '' }),
});

const recordInput = (value: unknown): Record<string, unknown> =>
  isUnknownRecord(value) ? value : {};

const recordArrayInput = (
  value: unknown,
): ReadonlyArray<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter(isUnknownRecord) : [];

const RawProductIdentityFromUnknown = Schema.transform(
  Schema.Unknown,
  RawProductIdentitySchema,
  {
    decode: (value: unknown) => recordInput(value),
    encode: (value) => value,
  },
);

const RawCategoryMappingsFromUnknown = Schema.transform(
  Schema.Unknown,
  Schema.Array(RawCategoryMappingSchema),
  {
    decode: (value: unknown) => recordArrayInput(value),
    encode: (value) => value,
  },
);

const RawSupplierMappingsFromUnknown = Schema.transform(
  Schema.Unknown,
  Schema.Array(RawSupplierMappingSchema),
  {
    decode: (value: unknown) => recordArrayInput(value),
    encode: (value) => value,
  },
);

const RawLocationMappingsFromUnknown = Schema.transform(
  Schema.Unknown,
  Schema.Array(RawLocationMappingSchema),
  {
    decode: (value: unknown) => recordArrayInput(value),
    encode: (value) => value,
  },
);

const RawWarningsFromUnknown = Schema.transform(
  Schema.Unknown,
  Schema.Array(RawWarningSchema),
  {
    decode: (value: unknown) => recordArrayInput(value),
    encode: (value) => value,
  },
);

const RawLlmProposalSchema = Schema.Struct({
  format: Schema.optionalWith(LenientFormat, { default: () => undefined }),
  confidence: Schema.optionalWith(LenientFiniteNumber, {
    default: () => undefined,
  }),
  productIdentity: Schema.optionalWith(RawProductIdentityFromUnknown, {
    default: () => ({ sourceColumn: '', conflictPolicy: undefined }),
  }),
  categoryMappings: Schema.optionalWith(RawCategoryMappingsFromUnknown, {
    default: () => [],
  }),
  supplierMappings: Schema.optionalWith(RawSupplierMappingsFromUnknown, {
    default: () => [],
  }),
  locationMappings: Schema.optionalWith(RawLocationMappingsFromUnknown, {
    default: () => [],
  }),
  warnings: Schema.optionalWith(RawWarningsFromUnknown, { default: () => [] }),
});

const RawLlmProposalFromUnknown = Schema.transform(
  Schema.Unknown,
  RawLlmProposalSchema,
  {
    decode: (value: unknown) => recordInput(value),
    encode: (value) => value,
  },
);

export type RawLlmProposal = Schema.Schema.Type<typeof RawLlmProposalSchema>;

export const decodeRawLlmProposal = Schema.decodeUnknownSync(
  RawLlmProposalFromUnknown,
);
