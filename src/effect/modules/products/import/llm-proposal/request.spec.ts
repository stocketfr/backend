import { LocationType } from '@stocket/types/locations';
import type { ProductImportPreviewDto } from '@stocket/types/products';
import type { NormalizedProductImportRow } from '../types';
import { makeOpenAiProductImportProposalRequest } from './request';

const normalizedRow = (
  overrides: Partial<NormalizedProductImportRow> = {},
): NormalizedProductImportRow => ({
  sourceRow: 2,
  sku: 'SKU-1',
  name: 'Product',
  category_path: 'Uncategorized',
  reorder_point: '0',
  quantity: '1',
  location: '',
  unit: '',
  standard_price: '',
  barcode: '',
  description: '',
  notes: '',
  is_active: 'true',
  is_perishable: 'false',
  expiry_date: '',
  photo_urls: [],
  ...overrides,
});

const categoryMapping = (
  index: number,
): ProductImportPreviewDto['categoryMappings'][number] => ({
  sourcePath: index === 0 ? 'Uncategorized' : `Category ${index}`,
  targetPath: index === 0 ? 'Uncategorized' : `Category ${index}`,
  action: index === 0 ? 'default' : 'create',
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
  photoUrlCount: 120,
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
      [
        normalizedRow({
          sourceRow: 2,
          sku: 'SPA-1',
          name: 'Lavender massage oil',
          category_path: 'Uncategorized',
          quantity: '2',
          location: 'Spa store',
          unit: 'bottle',
          description: 'Aromatherapy oil for massage treatments',
          notes: 'Treatment room supply',
        }),
      ],
    );

    expect(request.model).toBe('test-model');
    expect(request.text.format).toMatchObject({
      type: 'json_schema',
      name: 'product_import_ai_proposal_v2',
      strict: true,
      schema: { type: 'object', additionalProperties: false },
    });
    expect(
      request.text.format.schema.properties.locationMappings.items.properties
        .childAreas,
    ).toMatchObject({
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
      },
    });

    const userInput = request.input[1];
    if (!userInput) throw new Error('Expected user input message');
    const userContent = userInput.content[0];
    if (!userContent) throw new Error('Expected user input content');

    expect(request.input[0]?.content[0]?.text).toContain(
      'Never create a generic holding location such as Imported Inventory.',
    );

    const payload: {
      readonly preview: {
        readonly photoUrlCount: number;
        readonly categoryMappings: readonly unknown[];
        readonly locationMappings: readonly unknown[];
        readonly warnings: readonly unknown[];
        readonly categoryEvidence: readonly {
          readonly sourcePath: string;
          readonly rowCount: number;
          readonly complete: boolean;
          readonly examples: readonly {
            readonly name: string;
            readonly description?: string;
          }[];
        }[];
      };
      readonly tenantContext: {
        readonly categories: readonly unknown[];
        readonly locations: readonly unknown[];
        readonly areas: readonly unknown[];
      };
      readonly guidance: { readonly instructions: string };
    } = JSON.parse(userContent.text);

    expect(payload.preview.photoUrlCount).toBe(120);
    expect(payload.preview.categoryMappings).toHaveLength(81);
    expect(payload.preview.locationMappings).toHaveLength(81);
    expect(payload.preview.warnings).toHaveLength(40);
    expect(payload.preview.categoryEvidence).toEqual([
      {
        sourcePath: 'Uncategorized',
        rowCount: 1,
        complete: true,
        examples: [
          expect.objectContaining({
            name: 'Lavender massage oil',
            description: 'Aromatherapy oil for massage treatments',
          }),
        ],
      },
    ]);
    expect(payload.tenantContext.locations).toHaveLength(1);
    expect(payload.tenantContext.areas).toHaveLength(1);
    expect(payload.guidance.instructions).toBe('Keep bays beneath Warehouse.');
  });

  it('bounds evidence and marks sampled source groups incomplete', () => {
    const rows = Array.from({ length: 60 }, (_, groupIndex) =>
      Array.from({ length: 9 }, (_, exampleIndex) =>
        normalizedRow({
          sourceRow: groupIndex * 9 + exampleIndex + 2,
          sku: `PRIVATE-${'S'.repeat(80)}`,
          name: `${groupIndex}-${exampleIndex}-${'N'.repeat(140)}`,
          category_path:
            groupIndex === 0 ? 'Uncategorized' : `Category ${groupIndex}`,
          description: 'D'.repeat(240),
          notes: `PRIVATE-${'X'.repeat(180)}`,
          unit: 'U'.repeat(60),
        }),
      ),
    ).flat();
    const boundedPreview: ProductImportPreviewDto = {
      ...preview,
      totalRows: rows.length,
      itemRows: rows.length,
      importableRows: rows.length,
      categoryMappings: Array.from({ length: 60 }, (_, index) => ({
        ...categoryMapping(index),
        rowCount: 9,
      })),
    };

    const request = makeOpenAiProductImportProposalRequest(
      boundedPreview,
      { categories: [], locations: [], areas: [] },
      undefined,
      { model: 'test-model' },
      rows,
    );
    const userInput = request.input[1];
    if (!userInput) throw new Error('Expected user input message');
    const content = userInput.content[0];
    if (!content) throw new Error('Expected user input content');
    const payload = JSON.parse(content.text) as {
      readonly preview: {
        readonly categoryEvidence: readonly {
          readonly sourcePath: string;
          readonly complete: boolean;
          readonly examples: readonly unknown[];
        }[];
      };
    };
    const serializedEvidence = JSON.stringify(payload.preview.categoryEvidence);

    expect(serializedEvidence.length).toBeLessThanOrEqual(24_000);
    expect(payload.preview.categoryEvidence[0]).toMatchObject({
      sourcePath: 'Uncategorized',
      complete: false,
    });
    expect(payload.preview.categoryEvidence[0]?.examples).toHaveLength(8);
    expect(serializedEvidence).not.toContain('PRIVATE-');
  });

  it('bounds the complete user payload and reports omitted planning inputs', () => {
    const longValue = 'X'.repeat(500);
    const oversizedPreview: ProductImportPreviewDto = {
      ...preview,
      totalRows: 1_000,
      itemRows: 1_000,
      importableRows: 1_000,
      duplicateSkuConflicts: Array.from({ length: 500 }, (_, index) => ({
        sku: `SKU-${index}-${longValue}`,
        rows: [index + 2],
        names: [`Product ${index} ${longValue}`],
      })),
      categoryMappings: Array.from({ length: 1_000 }, (_, index) => ({
        sourcePath: `Category ${index} ${longValue}`,
        targetPath: `Category ${index} ${longValue}`,
        action: 'create' as const,
        rowCount: 1,
      })),
      locationMappings: Array.from({ length: 1_000 }, (_, index) => ({
        sourceLocation: `Location ${index} ${longValue}`,
        areaPath: `Area ${index} ${longValue}`,
        action: 'create-area' as const,
        confidence: 0.8,
        rowCount: 1,
      })),
    };
    const oversizedContext = {
      categories: Array.from({ length: 1_000 }, (_, index) => ({
        id: `category-${index}`,
        path: `Category ${index} ${longValue}`,
      })),
      locations: Array.from({ length: 300 }, (_, index) => ({
        id: `location-${index}`,
        name: `Location ${index} ${longValue}`,
        type: LocationType.WAREHOUSE,
      })),
      areas: Array.from({ length: 1_000 }, (_, index) => ({
        id: `area-${index}`,
        locationId: 'location-0',
        path: `Area ${index} ${longValue}`,
      })),
    };

    const request = makeOpenAiProductImportProposalRequest(
      oversizedPreview,
      oversizedContext,
      undefined,
      { model: 'test-model' },
    );
    const userInput = request.input[1];
    if (!userInput) throw new Error('Expected user input message');
    const content = userInput.content[0];
    if (!content) throw new Error('Expected user input content');
    const payload = JSON.parse(content.text) as {
      readonly preview: {
        readonly omittedCounts: {
          readonly duplicateSkuConflicts: number;
          readonly categoryMappings: number;
          readonly locationMappings: number;
        };
      };
      readonly tenantContext: {
        readonly omittedCounts: {
          readonly categories: number;
          readonly locations: number;
          readonly areas: number;
        };
      };
    };

    expect(content.text.length).toBeLessThanOrEqual(160_000);
    expect(payload.preview.omittedCounts.categoryMappings).toBeGreaterThan(0);
    expect(payload.preview.omittedCounts.locationMappings).toBeGreaterThan(0);
    expect(payload.preview.omittedCounts.duplicateSkuConflicts).toBeGreaterThan(
      0,
    );
    expect(payload.tenantContext.omittedCounts.categories).toBeGreaterThan(0);
    expect(payload.tenantContext.omittedCounts.locations).toBeGreaterThan(0);
    expect(payload.tenantContext.omittedCounts.areas).toBeGreaterThan(0);
  });
});
