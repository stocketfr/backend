import type {
  ProductImportPreviewDto,
  ProductImportProposalGuidanceDto,
  ProductImportTargetContextDto,
} from '@stocket/types/products';
import type { OpenAiProductImportConfig } from '../../../../../config/openai.utils';
import type { NormalizedProductImportRow } from '../types';
import { normalizeCategoryPath } from '../utils/csv';
import { PRODUCT_IMPORT_CATEGORY_EVIDENCE_MAX_EXAMPLES } from './shared';

const nullableString = { type: ['string', 'null'] } as const;

const openAiProductImportProposalSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'format',
    'confidence',
    'productIdentity',
    'skuConflictResolutions',
    'missingLocationStrategy',
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
    skuConflictResolutions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'conflictKey',
          'confidence',
          'reason',
          'reviewRequired',
          'variants',
        ],
        properties: {
          conflictKey: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: nullableString,
          reviewRequired: { type: 'boolean' },
          variants: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['variantKey', 'action', 'targetSku'],
              properties: {
                variantKey: { type: 'string' },
                action: {
                  enum: ['keep-source-sku', 'derive-sku', 'custom-sku', 'skip'],
                },
                targetSku: nullableString,
              },
            },
          },
        },
      },
    },
    missingLocationStrategy: {
      type: 'object',
      additionalProperties: false,
      required: [
        'action',
        'targetLocationId',
        'targetLocationName',
        'targetAreaId',
        'areaPath',
        'confidence',
        'reason',
        'reviewRequired',
      ],
      properties: {
        action: {
          enum: ['assign-review-area', 'use-existing-area', 'skip-inventory'],
        },
        targetLocationId: nullableString,
        targetLocationName: nullableString,
        targetAreaId: nullableString,
        areaPath: nullableString,
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        reason: nullableString,
        reviewRequired: { type: 'boolean' },
      },
    },
    categoryMappings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sourcePath',
          'targetCategoryId',
          'targetPath',
          'action',
          'confidence',
          'reason',
          'reviewRequired',
        ],
        properties: {
          sourcePath: { type: 'string' },
          targetCategoryId: nullableString,
          targetPath: { type: 'string' },
          action: { enum: ['use-existing', 'create', 'default'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: nullableString,
          reviewRequired: { type: 'boolean' },
        },
      },
    },
    supplierMappings: {
      type: 'array',
      maxItems: 0,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [],
        properties: {},
      },
    },
    locationMappings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sourceLocation',
          'targetLocationId',
          'targetLocationName',
          'targetAreaId',
          'areaPath',
          'childAreas',
          'action',
          'confidence',
          'reason',
          'reviewRequired',
        ],
        properties: {
          sourceLocation: { type: 'string' },
          targetLocationId: nullableString,
          targetLocationName: nullableString,
          targetAreaId: nullableString,
          areaPath: nullableString,
          childAreas: {
            type: 'array',
            maxItems: 20,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 100 },
              },
            },
          },
          action: {
            enum: [
              'use-existing',
              'use-existing-area',
              'create-location',
              'create-area',
              'ignore',
            ],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: nullableString,
          reviewRequired: { type: 'boolean' },
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
          row: { type: ['number', 'null'] },
          field: nullableString,
          severity: { enum: ['error', 'warning'] },
          message: { type: 'string' },
        },
      },
    },
  },
} as const;

const MAX_CATEGORY_EVIDENCE_GROUPS = 50;
const MAX_CATEGORY_EVIDENCE_CHARS = 24_000;
const MAX_USER_PAYLOAD_CHARS = 160_000;
const CATEGORY_MAPPING_BUDGET_CHARS = 24_000;
const LOCATION_MAPPING_BUDGET_CHARS = 24_000;
const DUPLICATE_CONFLICT_BUDGET_CHARS = 12_000;
const WARNING_BUDGET_CHARS = 8_000;
const CATEGORY_CONTEXT_BUDGET_CHARS = 20_000;
const LOCATION_CONTEXT_BUDGET_CHARS = 8_000;
const AREA_CONTEXT_BUDGET_CHARS = 20_000;
const GUIDANCE_BUDGET_CHARS = 12_000;

const compactEvidenceText = (value: string, maxLength: number): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, maxLength);

const takeWithinCharBudget = <T>(
  values: readonly T[],
  maxChars: number,
): { readonly items: readonly T[]; readonly omitted: number } => {
  const items: T[] = [];
  let usedChars = 2;
  for (const value of values) {
    const valueChars =
      JSON.stringify(value).length + (items.length > 0 ? 1 : 0);
    if (usedChars + valueChars > maxChars) continue;
    items.push(value);
    usedChars += valueChars;
  }
  return { items, omitted: values.length - items.length };
};

const compactCategoryEvidence = (
  preview: ProductImportPreviewDto,
  rows: readonly NormalizedProductImportRow[],
) => {
  const rowsBySource = new Map<string, NormalizedProductImportRow[]>();
  for (const row of rows) {
    const sourcePath = normalizeCategoryPath(row.category_path);
    const sourceRows = rowsBySource.get(sourcePath) ?? [];
    sourceRows.push(row);
    rowsBySource.set(sourcePath, sourceRows);
  }

  const mappings = [...preview.categoryMappings].sort(
    (left, right) =>
      Number(right.action === 'default') - Number(left.action === 'default'),
  );
  const evidence: {
    sourcePath: string;
    rowCount: number;
    complete: boolean;
    examples: {
      name: string;
      description?: string;
      unit?: string;
    }[];
  }[] = [];
  let usedChars = 2;

  for (const mapping of mappings) {
    if (evidence.length >= MAX_CATEGORY_EVIDENCE_GROUPS) break;
    const sourceRows = rowsBySource.get(mapping.sourcePath) ?? [];
    if (sourceRows.length === 0) continue;
    const examples = sourceRows
      .slice(0, PRODUCT_IMPORT_CATEGORY_EVIDENCE_MAX_EXAMPLES)
      .map((row) => {
        const description = compactEvidenceText(row.description, 180);
        const unit = compactEvidenceText(row.unit, 40);
        return {
          name: compactEvidenceText(row.name, 140),
          ...(description ? { description } : {}),
          ...(unit ? { unit } : {}),
        };
      });
    const candidate = {
      sourcePath: mapping.sourcePath,
      rowCount: sourceRows.length,
      complete:
        sourceRows.length <= PRODUCT_IMPORT_CATEGORY_EVIDENCE_MAX_EXAMPLES,
      examples,
    };
    const candidateChars = JSON.stringify(candidate).length + 1;
    if (usedChars + candidateChars > MAX_CATEGORY_EVIDENCE_CHARS) continue;
    evidence.push(candidate);
    usedChars += candidateChars;
  }

  return evidence;
};

const compactPreviewForLlm = (
  preview: ProductImportPreviewDto,
  rows: readonly NormalizedProductImportRow[],
) => {
  const orderedCategoryMappings = [...preview.categoryMappings].sort(
    (left, right) =>
      Number(right.action === 'default') - Number(left.action === 'default'),
  );
  const categoryMappings = takeWithinCharBudget(
    orderedCategoryMappings,
    CATEGORY_MAPPING_BUDGET_CHARS,
  );
  const locationMappings = takeWithinCharBudget(
    preview.locationMappings,
    LOCATION_MAPPING_BUDGET_CHARS,
  );
  const duplicateSkuConflicts = takeWithinCharBudget(
    preview.duplicateSkuConflicts,
    DUPLICATE_CONFLICT_BUDGET_CHARS,
  );
  const warnings = takeWithinCharBudget(
    preview.warnings.slice(0, 40),
    WARNING_BUDGET_CHARS,
  );
  const evidencePreview = {
    ...preview,
    categoryMappings: categoryMappings.items,
  };

  return {
    format: preview.format,
    totalRows: preview.totalRows,
    itemRows: preview.itemRows,
    folderRows: preview.folderRows,
    photoUrlCount: preview.photoUrlCount,
    importableRows: preview.importableRows,
    missingRequiredRows: preview.missingRequiredRows,
    duplicateSkuConflicts: duplicateSkuConflicts.items,
    categoryMappings: categoryMappings.items,
    categoryEvidence: compactCategoryEvidence(evidencePreview, rows),
    locationMappings: locationMappings.items,
    warnings: warnings.items,
    omittedCounts: {
      duplicateSkuConflicts: duplicateSkuConflicts.omitted,
      categoryMappings: categoryMappings.omitted,
      locationMappings: locationMappings.omitted,
      warnings: preview.warnings.length - warnings.items.length,
    },
  };
};

const compactContextForLlm = (context: ProductImportTargetContextDto) => {
  const categories = takeWithinCharBudget(
    context.categories,
    CATEGORY_CONTEXT_BUDGET_CHARS,
  );
  const locations = takeWithinCharBudget(
    context.locations,
    LOCATION_CONTEXT_BUDGET_CHARS,
  );
  const includedLocationIds = new Set(locations.items.map(({ id }) => id));
  const eligibleAreas = context.areas.filter(({ locationId }) =>
    includedLocationIds.has(locationId),
  );
  const areas = takeWithinCharBudget(eligibleAreas, AREA_CONTEXT_BUDGET_CHARS);
  const omittedAreas =
    context.areas.length - eligibleAreas.length + areas.omitted;
  const truncated =
    context.truncated === true ||
    categories.omitted > 0 ||
    locations.omitted > 0 ||
    omittedAreas > 0;

  return {
    categories: categories.items,
    locations: locations.items,
    areas: areas.items,
    ...(truncated ? { truncated: true } : {}),
    omittedCounts: {
      categories: categories.omitted,
      locations: locations.omitted,
      areas: omittedAreas,
    },
  };
};

const compactGuidanceForLlm = (
  guidance: ProductImportProposalGuidanceDto | undefined,
) => {
  if (!guidance) return null;
  if (JSON.stringify(guidance).length <= GUIDANCE_BUDGET_CHARS) return guidance;
  const instructions = compactEvidenceText(guidance.instructions ?? '', 4_000);
  return {
    ...(instructions ? { instructions } : {}),
    planOmittedForBudget: true,
  };
};

export const makeOpenAiProductImportProposalRequest = (
  preview: ProductImportPreviewDto,
  context: ProductImportTargetContextDto,
  guidance: ProductImportProposalGuidanceDto | undefined,
  config: Pick<OpenAiProductImportConfig, 'model'>,
  rows: readonly NormalizedProductImportRow[] = [],
) => {
  const payloadText = JSON.stringify({
    task: 'Propose a reviewed product-import structure.',
    preview: compactPreviewForLlm(preview, rows),
    tenantContext: compactContextForLlm(context),
    guidance: compactGuidanceForLlm(guidance),
  });
  if (payloadText.length > MAX_USER_PAYLOAD_CHARS) {
    throw new Error('Product import AI payload exceeded its safety budget.');
  }

  return {
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
              'Make complete import decisions instead of returning a task list for the user.',
              'Set reviewRequired only when no safe, structurally complete decision can be made from the source evidence and tenant context; low confidence alone is not a reason to request review.',
              'Use categoryEvidence product names, descriptions, and units to understand unclear source categories. Its complete flag is true only when every row in that source group is represented.',
              'For an Uncategorized source, infer a shared category only when categoryEvidence is present, complete is true, and every example is semantically coherent. If evidence is absent, incomplete, mixed, or genuinely unknowable, use action default with targetPath Uncategorized and reviewRequired false; this is an explicit automatic fallback, not a request for the user to enter a path.',
              'The request may omit mappings or tenant context to stay within its safety budget. Decide only the included sources; the server applies deterministic fallbacks to omitted sources.',
              'Never invent source category or location names; use only sources present in the preview.',
              'Only reference category, location, and area IDs from tenantContext.',
              'An existing area must belong to its target location.',
              'Prefer locations for sites and nested area paths for shelves, bays, racks, bins, rooms, and drawers.',
              'Use childAreas only to create empty direct children beneath an area target; childAreas never changes where product inventory is assigned. Return an empty childAreas array for mappings without requested children.',
              'Place missing locations in an explicit Unassigned / Needs Review area beneath the best location already reused or created by locationMappings. Never create a generic holding location such as Imported Inventory.',
              'Return an empty supplierMappings array.',
              'Respect user guidance and locked decisions; the server will enforce locks after your response.',
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
            text: payloadText,
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'product_import_ai_proposal_v2',
        strict: true,
        schema: openAiProductImportProposalSchema,
      },
    },
  };
};
