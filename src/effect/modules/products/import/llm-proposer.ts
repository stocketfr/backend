import { Effect } from 'effect';
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

const clampConfidence = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asPositiveInteger = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return fallback;
  }
  return value;
};

const categoryAction = (
  value: unknown,
  fallback: ProductImportCategoryMappingDto['action'],
): ProductImportCategoryMappingDto['action'] =>
  value === 'use-existing' || value === 'create' || value === 'default'
    ? value
    : fallback;

const supplierAction = (
  value: unknown,
): ProductImportSupplierMappingDto['action'] =>
  value === 'use-existing' || value === 'create' || value === 'ignore'
    ? value
    : 'ignore';

const locationAction = (
  value: unknown,
  fallback: ProductImportLocationMappingDto['action'],
): ProductImportLocationMappingDto['action'] =>
  value === 'use-existing' ||
  value === 'create-location' ||
  value === 'create-area' ||
  value === 'ignore'
    ? value
    : fallback;

const warningSeverity = (
  value: unknown,
): ProductImportWarningDto['severity'] =>
  value === 'error' || value === 'warning' ? value : 'warning';

const sanitizeWarnings = (
  value: unknown,
  preview: ProductImportPreviewDto,
): ProductImportWarningDto[] => {
  const llmWarnings = Array.isArray(value) ? value : [];
  const sanitized = llmWarnings.flatMap((warning) => {
    if (!isRecord(warning)) return [];
    const message = asString(warning.message);
    if (!message) return [];
    return [
      {
        ...(typeof warning.row === 'number' && Number.isInteger(warning.row)
          ? { row: warning.row }
          : {}),
        ...(typeof warning.field === 'string' && warning.field.trim()
          ? { field: warning.field.trim() }
          : {}),
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
  if (!isRecord(raw)) {
    throw new Error('LLM response was not a JSON object');
  }

  const fallback = makeProductImportProposal(preview);
  const rawProductIdentity = isRecord(raw.productIdentity)
    ? raw.productIdentity
    : {};
  const sourceColumn =
    asString(rawProductIdentity.sourceColumn) ||
    fallback.productIdentity.sourceColumn;
  const conflictPolicy =
    rawProductIdentity.conflictPolicy === 'derive-sku' ||
    rawProductIdentity.conflictPolicy === 'reject'
      ? rawProductIdentity.conflictPolicy
      : fallback.productIdentity.conflictPolicy;

  const rawCategories = Array.isArray(raw.categoryMappings)
    ? raw.categoryMappings
    : [];
  const rawCategoriesBySource = new Map(
    rawCategories
      .filter(isRecord)
      .map((mapping) => [asString(mapping.sourcePath), mapping] as const),
  );
  const categoryMappings = preview.categoryMappings.map((mapping) => {
    const proposed = rawCategoriesBySource.get(mapping.sourcePath);
    if (!proposed)
      return (
        fallback.categoryMappings.find(
          (item) => item.sourcePath === mapping.sourcePath,
        ) ?? mapping
      );
    const targetPath = asString(proposed.targetPath);
    return {
      sourcePath: mapping.sourcePath,
      targetPath: targetPath || mapping.targetPath,
      action: categoryAction(proposed.action, mapping.action),
      rowCount: mapping.rowCount,
    };
  });

  const rawLocations = Array.isArray(raw.locationMappings)
    ? raw.locationMappings
    : [];
  const rawLocationsBySource = new Map(
    rawLocations
      .filter(isRecord)
      .map((mapping) => [asString(mapping.sourceLocation), mapping] as const),
  );
  const locationMappings = preview.locationMappings.map((mapping) => {
    const proposed = rawLocationsBySource.get(mapping.sourceLocation);
    if (!proposed) return mapping;
    const areaPath = asString(proposed.areaPath);
    const targetLocationName = asString(proposed.targetLocationName);
    return {
      sourceLocation: mapping.sourceLocation,
      ...(targetLocationName ? { targetLocationName } : {}),
      ...(areaPath ? { areaPath } : {}),
      action: locationAction(proposed.action, mapping.action),
      confidence: clampConfidence(proposed.confidence, mapping.confidence),
      rowCount: mapping.rowCount,
    };
  });

  const rawSuppliers = Array.isArray(raw.supplierMappings)
    ? raw.supplierMappings
    : [];
  const supplierMappings = rawSuppliers.flatMap((mapping) => {
    if (!isRecord(mapping)) return [];
    const sourcePattern = asString(mapping.sourcePattern);
    const supplierName = asString(mapping.supplierName);
    if (!sourcePattern || !supplierName) return [];
    return [
      {
        sourcePattern,
        supplierName,
        action: supplierAction(mapping.action),
        confidence: clampConfidence(mapping.confidence, 0.5),
        rowCount: asPositiveInteger(mapping.rowCount, 0),
      } satisfies ProductImportSupplierMappingDto,
    ];
  });

  return {
    format:
      raw.format === 'normalized-products' || raw.format === 'sortly-items'
        ? raw.format
        : preview.format,
    confidence: clampConfidence(raw.confidence, fallback.confidence),
    productIdentity: {
      sourceColumn,
      conflictPolicy,
    },
    categoryMappings,
    supplierMappings,
    locationMappings,
    warnings: sanitizeWarnings(raw.warnings, preview),
  };
};

const responseText = (json: Record<string, unknown>): string => {
  if (typeof json.output_text === 'string') return json.output_text;
  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
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

    const json = (await response.json()) as Record<string, unknown>;
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
                `AI proposal unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
              ),
            ),
          ),
        );

      return { propose };
    }),
  },
) {}
