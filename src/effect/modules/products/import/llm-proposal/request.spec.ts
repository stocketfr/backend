import type { ProductImportPreviewDto } from '@stocket/types/products';
import { makeOpenAiProductImportProposalRequest } from './request';

const categoryMapping = (
  index: number,
): ProductImportPreviewDto['categoryMappings'][number] => ({
  sourcePath: `Category ${index}`,
  targetPath: `Category ${index}`,
  action: 'create',
  rowCount: 1,
});

const locationMapping = (
  index: number,
): ProductImportPreviewDto['locationMappings'][number] => ({
  sourceLocation: `Bay ${index}`,
  areaPath: `Bay ${index}`,
  action: 'create-area',
  confidence: 0.8,
  rowCount: 1,
});

const warning = (
  index: number,
): ProductImportPreviewDto['warnings'][number] => ({
  severity: 'warning',
  message: `Warning ${index}`,
});

const preview: ProductImportPreviewDto = {
  format: 'sortly-items',
  totalRows: 100,
  itemRows: 90,
  folderRows: 10,
  importableRows: 80,
  missingRequiredRows: 0,
  duplicateSkuConflicts: Array.from({ length: 31 }, (_, index) => ({
    sku: `SKU-${index}`,
    rows: [index + 1],
    names: [`Product ${index}`],
  })),
  categoryMappings: Array.from({ length: 81 }, (_, index) =>
    categoryMapping(index),
  ),
  supplierMappings: [],
  locationMappings: Array.from({ length: 81 }, (_, index) =>
    locationMapping(index),
  ),
  inventoryPreviews: [],
  warnings: Array.from({ length: 31 }, (_, index) => warning(index)),
};

describe('makeOpenAiProductImportProposalRequest', () => {
  it('builds the Responses API request and compacts large preview arrays', () => {
    const request = makeOpenAiProductImportProposalRequest(preview, {
      model: 'test-model',
    });

    expect(request.model).toBe('test-model');
    expect(request.text.format).toMatchObject({
      type: 'json_schema',
      name: 'product_import_ai_proposal',
      strict: true,
      schema: { type: 'object', additionalProperties: false },
    });

    const userInput = request.input[1];
    expect(userInput).toBeDefined();
    if (!userInput) throw new Error('Expected user input message');

    const userContent = userInput.content[0];
    expect(userContent).toBeDefined();
    if (!userContent) throw new Error('Expected user input content');

    const payload: {
      readonly preview: {
        readonly duplicateSkuConflicts: readonly unknown[];
        readonly categoryMappings: readonly unknown[];
        readonly locationMappings: readonly unknown[];
        readonly warnings: readonly unknown[];
      };
    } = JSON.parse(userContent.text);

    expect(payload.preview.duplicateSkuConflicts).toHaveLength(30);
    expect(payload.preview.categoryMappings).toHaveLength(80);
    expect(payload.preview.locationMappings).toHaveLength(80);
    expect(payload.preview.warnings).toHaveLength(30);
    expect(payload.preview).not.toHaveProperty('inventoryPreviews');
  });
});
