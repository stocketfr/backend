import { LocationType } from '@stocket/types/locations';
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

const preview: ProductImportPreviewDto = {
  format: 'sortly-items',
  totalRows: 100,
  itemRows: 90,
  folderRows: 10,
  importableRows: 80,
  missingRequiredRows: 0,
  duplicateSkuConflicts: [],
  categoryMappings: Array.from({ length: 81 }, (_, index) =>
    categoryMapping(index),
  ),
  supplierMappings: [],
  locationMappings: Array.from({ length: 81 }, (_, index) =>
    locationMapping(index),
  ),
  inventoryPreviews: [],
  warnings: Array.from({ length: 41 }, (_, index) => ({
    severity: 'warning',
    message: `Warning ${index}`,
  })),
};

describe('makeOpenAiProductImportProposalRequest', () => {
  it('includes complete source coverage, compact tenant context, and guidance', () => {
    const request = makeOpenAiProductImportProposalRequest(
      preview,
      {
        categories: [{ id: 'cat-1', path: 'Existing / Category' }],
        locations: [
          {
            id: 'loc-1',
            name: 'Warehouse',
            type: LocationType.WAREHOUSE,
          },
        ],
        areas: [{ id: 'area-1', locationId: 'loc-1', path: 'Bay I / Shelf 3' }],
      },
      { instructions: 'Keep bays beneath Warehouse.' },
      { model: 'test-model' },
    );

    expect(request.model).toBe('test-model');
    expect(request.text.format).toMatchObject({
      type: 'json_schema',
      name: 'product_import_ai_proposal_v2',
      strict: true,
      schema: { type: 'object', additionalProperties: false },
    });

    const userInput = request.input[1];
    if (!userInput) throw new Error('Expected user input message');
    const userContent = userInput.content[0];
    if (!userContent) throw new Error('Expected user input content');

    const payload: {
      readonly preview: {
        readonly categoryMappings: readonly unknown[];
        readonly locationMappings: readonly unknown[];
        readonly warnings: readonly unknown[];
      };
      readonly tenantContext: {
        readonly categories: readonly unknown[];
        readonly locations: readonly unknown[];
        readonly areas: readonly unknown[];
      };
      readonly guidance: { readonly instructions: string };
    } = JSON.parse(userContent.text);

    expect(payload.preview.categoryMappings).toHaveLength(81);
    expect(payload.preview.locationMappings).toHaveLength(81);
    expect(payload.preview.warnings).toHaveLength(40);
    expect(payload.tenantContext.locations).toHaveLength(1);
    expect(payload.tenantContext.areas).toHaveLength(1);
    expect(payload.guidance.instructions).toBe('Keep bays beneath Warehouse.');
  });
});
