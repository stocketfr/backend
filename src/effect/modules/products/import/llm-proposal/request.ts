import type {
  ProductImportPreviewDto,
  ProductImportProposalGuidanceDto,
  ProductImportTargetContextDto,
} from '@stocket/types/products';
import type { OpenAiProductImportConfig } from '../../../../../config/openai.utils';

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

const compactPreviewForLlm = (preview: ProductImportPreviewDto) => ({
  format: preview.format,
  totalRows: preview.totalRows,
  itemRows: preview.itemRows,
  folderRows: preview.folderRows,
  photoUrlCount: preview.photoUrlCount,
  importableRows: preview.importableRows,
  missingRequiredRows: preview.missingRequiredRows,
  duplicateSkuConflicts: preview.duplicateSkuConflicts,
  categoryMappings: preview.categoryMappings,
  locationMappings: preview.locationMappings,
  warnings: preview.warnings.slice(0, 40),
});

export const makeOpenAiProductImportProposalRequest = (
  preview: ProductImportPreviewDto,
  context: ProductImportTargetContextDto,
  guidance: ProductImportProposalGuidanceDto | undefined,
  config: Pick<OpenAiProductImportConfig, 'model'>,
) => ({
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
            'Infer as much as possible and mark uncertain decisions for review.',
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
          text: JSON.stringify({
            task: 'Propose a reviewed product-import structure.',
            preview: compactPreviewForLlm(preview),
            tenantContext: context,
            guidance: guidance ?? null,
          }),
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
});
