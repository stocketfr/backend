import { Effect, Schema } from 'effect';
import type {
  ProductImportAiProposalDto,
  ProductImportCategoryMappingDto,
  ProductImportLocationMappingDto,
  ProductImportPreviewDto,
  ProductImportSupplierMappingDto,
  ProductImportWarningDto,
} from '@stocket/types/products';
import {
  getOpenAiProductImportConfig,
  type OpenAiProductImportConfig,
} from '../../../../config/openai.utils';
import { makeProductImportProposal } from './utils';

type FetchLike = typeof fetch;

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const messageFromUnknown = (value: unknown, fallback: string): string => {
  if (value instanceof Error && value.message.trim() !== '') {
    return value.message;
  }

  if (
    isUnknownRecord(value) &&
    typeof value.message === 'string' &&
    value.message.trim() !== ''
  ) {
    return value.message;
  }

  return fallback;
};

const proposalSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'format',
    'confidence',
    'productIdentity',
    'categoryMappings',
    'supplierMappings',
    'locationMappings',
    'warnings',
  ],
  properties: {
    format: { enum: ['normalized-products', 'sortly-items', 'unknown'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    productIdentity: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceColumn', 'conflictPolicy'],
      properties: {
        sourceColumn: { type: 'string' },
        conflictPolicy: { enum: ['reject', 'derive-sku'] },
      },
    },
    categoryMappings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourcePath', 'targetPath', 'action', 'rowCount'],
        properties: {
          sourcePath: { type: 'string' },
          targetPath: { type: 'string' },
          action: { enum: ['use-existing', 'create', 'default'] },
          rowCount: { type: 'integer', minimum: 0 },
        },
      },
    },
    supplierMappings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sourcePattern',
          'supplierName',
          'action',
          'confidence',
          'rowCount',
        ],
        properties: {
          sourcePattern: { type: 'string' },
          supplierName: { type: 'string' },
          action: { enum: ['use-existing', 'create', 'ignore'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          rowCount: { type: 'integer', minimum: 0 },
        },
      },
    },
    locationMappings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sourceLocation',
          'targetLocationName',
          'areaPath',
          'action',
          'confidence',
          'rowCount',
        ],
        properties: {
          sourceLocation: { type: 'string' },
          targetLocationName: { type: 'string' },
          areaPath: { type: 'string' },
          action: {
            enum: ['use-existing', 'create-location', 'create-area', 'ignore'],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          rowCount: { type: 'integer', minimum: 0 },
        },
      },
    },
    warnings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['row', 'field', 'severity', 'message'],
        properties: {
          row: { type: ['integer', 'null'] },
          field: { type: ['string', 'null'] },
          severity: { enum: ['error', 'warning'] },
          message: { type: 'string' },
        },
      },
    },
  },
} as const;

const compactPreviewForLlm = (preview: ProductImportPreviewDto) => ({
  format: preview.format,
  totalRows: preview.totalRows,
  itemRows: preview.itemRows,
  folderRows: preview.folderRows,
  importableRows: preview.importableRows,
  missingRequiredRows: preview.missingRequiredRows,
  duplicateSkuConflicts: preview.duplicateSkuConflicts.slice(0, 30),
  categoryMappings: preview.categoryMappings.slice(0, 80),
  locationMappings: preview.locationMappings.slice(0, 80),
  warnings: preview.warnings.slice(0, 30),
});

const appendWarning = (
  proposal: ProductImportAiProposalDto,
  message: string,
): ProductImportAiProposalDto => ({
  ...proposal,
  warnings: [
    ...proposal.warnings,
    {
      severity: 'warning',
      message,
    },
  ],
});

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

const decodeRawLlmProposal = Schema.decodeUnknownSync(RawLlmProposalSchema);

const clampConfidence = (
  value: number | undefined,
  fallback: number,
): number => {
  if (value === undefined) return fallback;
  return Math.max(0, Math.min(1, value));
};

const nonNegativeIntegerOr = (
  value: number | undefined,
  fallback: number,
): number => value ?? fallback;

const categoryAction = (
  value: ProductImportCategoryMappingDto['action'] | undefined,
  fallback: ProductImportCategoryMappingDto['action'],
): ProductImportCategoryMappingDto['action'] => value ?? fallback;

const supplierAction = (
  value: ProductImportSupplierMappingDto['action'] | undefined,
): ProductImportSupplierMappingDto['action'] => value ?? 'ignore';

const locationAction = (
  value: ProductImportLocationMappingDto['action'] | undefined,
  fallback: ProductImportLocationMappingDto['action'],
): ProductImportLocationMappingDto['action'] => value ?? fallback;

const warningSeverity = (
  value: ProductImportWarningDto['severity'] | undefined,
): ProductImportWarningDto['severity'] => value ?? 'warning';

const sanitizeWarnings = (
  llmWarnings: ReadonlyArray<Schema.Schema.Type<typeof RawWarningSchema>>,
  preview: ProductImportPreviewDto,
): ProductImportWarningDto[] => {
  const sanitized = llmWarnings.flatMap((warning) => {
    const message = warning.message;
    if (!message) return [];
    return [
      {
        ...(warning.row !== undefined ? { row: warning.row } : {}),
        ...(warning.field ? { field: warning.field } : {}),
        severity: warningSeverity(warning.severity),
        message,
      } satisfies ProductImportWarningDto,
    ];
  });

  const requiredPreviewWarnings = preview.warnings.filter(
    (warning) => warning.severity === 'error',
  );
  return [...requiredPreviewWarnings, ...sanitized].slice(0, 40);
};

const sanitizeLlmProposal = (
  raw: unknown,
  preview: ProductImportPreviewDto,
): ProductImportAiProposalDto => {
  const proposal = decodeRawLlmProposal(raw);

  const fallback = makeProductImportProposal(preview);
  const sourceColumn =
    proposal.productIdentity.sourceColumn ||
    fallback.productIdentity.sourceColumn;
  const conflictPolicy =
    proposal.productIdentity.conflictPolicy ??
    fallback.productIdentity.conflictPolicy;

  const rawCategoriesBySource = new Map(
    proposal.categoryMappings.map(
      (mapping) => [mapping.sourcePath, mapping] as const,
    ),
  );
  const categoryMappings = preview.categoryMappings.map((mapping) => {
    const proposed = rawCategoriesBySource.get(mapping.sourcePath);
    if (!proposed)
      return (
        fallback.categoryMappings.find(
          (item) => item.sourcePath === mapping.sourcePath,
        ) ?? mapping
      );
    const targetPath = proposed.targetPath;
    return {
      sourcePath: mapping.sourcePath,
      targetPath: targetPath || mapping.targetPath,
      action: categoryAction(proposed.action, mapping.action),
      rowCount: mapping.rowCount,
    };
  });

  const rawLocationsBySource = new Map(
    proposal.locationMappings.map(
      (mapping) => [mapping.sourceLocation, mapping] as const,
    ),
  );
  const locationMappings = preview.locationMappings.map((mapping) => {
    const proposed = rawLocationsBySource.get(mapping.sourceLocation);
    if (!proposed) return mapping;
    const areaPath = proposed.areaPath;
    const targetLocationName = proposed.targetLocationName;
    return {
      sourceLocation: mapping.sourceLocation,
      ...(targetLocationName ? { targetLocationName } : {}),
      ...(areaPath ? { areaPath } : {}),
      action: locationAction(proposed.action, mapping.action),
      confidence: clampConfidence(proposed.confidence, mapping.confidence),
      rowCount: mapping.rowCount,
    };
  });

  const supplierMappings = proposal.supplierMappings.flatMap((mapping) => {
    const sourcePattern = mapping.sourcePattern;
    const supplierName = mapping.supplierName;
    if (!sourcePattern || !supplierName) return [];
    return [
      {
        sourcePattern,
        supplierName,
        action: supplierAction(mapping.action),
        confidence: clampConfidence(mapping.confidence, 0.5),
        rowCount: nonNegativeIntegerOr(mapping.rowCount, 0),
      } satisfies ProductImportSupplierMappingDto,
    ];
  });

  return {
    format: proposal.format ?? preview.format,
    confidence: clampConfidence(proposal.confidence, fallback.confidence),
    productIdentity: {
      sourceColumn,
      conflictPolicy,
    },
    categoryMappings,
    supplierMappings,
    locationMappings,
    warnings: sanitizeWarnings(proposal.warnings, preview),
  };
};

const responseText = (json: unknown): string => {
  if (!isUnknownRecord(json)) {
    throw new Error('OpenAI response was not a JSON object');
  }

  if (typeof json.output_text === 'string') return json.output_text;
  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    if (!isUnknownRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isUnknownRecord(content)) continue;
      if (typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('OpenAI response did not include output text');
};

async function callOpenAiForProposal(
  preview: ProductImportPreviewDto,
  config: OpenAiProductImportConfig,
  fetchImpl: FetchLike,
): Promise<ProductImportAiProposalDto> {
  if (!config.apiKey) {
    return appendWarning(
      makeProductImportProposal(preview),
      'AI proposal unavailable because OPENAI_API_KEY is not configured.',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(
      `${config.baseUrl.replace(/\/+$/, '')}/responses`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text: [
                    'You design clean product import structures for Stocket.',
                    'Return only the requested JSON schema.',
                    'Never invent source category or location names; use only sources present in the preview.',
                    'Keep inventory quantities out of the proposal.',
                    'Prefer locations for sites and area paths for shelves, bays, racks, bins, rooms, and drawers.',
                    'Preserve deterministic error warnings.',
                  ].join(' '),
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: JSON.stringify({
                    task: 'Propose a reviewed product-import structure.',
                    preview: compactPreviewForLlm(preview),
                  }),
                },
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'product_import_ai_proposal',
              strict: true,
              schema: proposalSchema,
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `OpenAI proposal request failed with status ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`,
      );
    }

    const json = await response.json();
    return sanitizeLlmProposal(JSON.parse(responseText(json)), preview);
  } finally {
    clearTimeout(timeout);
  }
}

export class ProductImportLlmProposer extends Effect.Service<ProductImportLlmProposer>()(
  '@stocket/effect/products/ProductImportLlmProposer',
  {
    effect: Effect.sync(() => {
      const propose = (
        preview: ProductImportPreviewDto,
      ): Effect.Effect<ProductImportAiProposalDto> =>
        Effect.tryPromise({
          try: () =>
            callOpenAiForProposal(
              preview,
              getOpenAiProductImportConfig(),
              globalThis.fetch.bind(globalThis),
            ),
          catch: (cause) => cause,
        }).pipe(
          Effect.catchAll((cause) =>
            Effect.succeed(
              appendWarning(
                makeProductImportProposal(preview),
                `AI proposal unavailable: ${messageFromUnknown(cause, String(cause))}`,
              ),
            ),
          ),
        );

      return { propose };
    }),
  },
) {}
