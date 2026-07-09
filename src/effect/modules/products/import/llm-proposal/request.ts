import type { ProductImportPreviewDto } from '@stocket/types/products';
import type { OpenAiProductImportConfig } from '../../../../../config/openai.utils';

const openAiProductImportProposalSchema = {
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

export const makeOpenAiProductImportProposalRequest = (
  preview: ProductImportPreviewDto,
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
      schema: openAiProductImportProposalSchema,
    },
  },
});
