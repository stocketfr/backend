import type { ProductImportPreviewDto } from '../types';
import { makeProductImportProposal } from './proposal';

const preview = (
  overrides: Partial<ProductImportPreviewDto> = {},
): ProductImportPreviewDto => ({
  format: 'sortly-items',
  totalRows: 2,
  itemRows: 2,
  folderRows: 0,
  importableRows: 2,
  missingRequiredRows: 0,
  duplicateSkuConflicts: [],
  categoryMappings: [
    {
      sourcePath: 'Dental Care',
      targetPath: 'Dental Care',
      action: 'create',
      rowCount: 2,
    },
    {
      sourcePath: 'Uncategorized',
      targetPath: 'Uncategorized',
      action: 'default',
      rowCount: 1,
    },
  ],
  supplierMappings: [],
  locationMappings: [
    {
      sourceLocation: 'Bay I - Shelf 3',
      areaPath: 'Bay I / Shelf 3',
      action: 'create-area',
      confidence: 0.5,
      rowCount: 2,
    },
  ],
  inventoryPreviews: [],
  warnings: [],
  ...overrides,
});

describe('makeProductImportProposal', () => {
  it('maps common category source paths into reviewed target paths', () => {
    const proposal = makeProductImportProposal(preview());

    expect(proposal.categoryMappings).toEqual([
      {
        sourcePath: 'Dental Care',
        targetPath: 'Guest Accessories / Dental',
        action: 'create',
        rowCount: 2,
      },
      {
        sourcePath: 'Uncategorized',
        targetPath: 'Needs Review / Uncategorized',
        action: 'default',
        rowCount: 1,
      },
    ]);
    expect(proposal.locationMappings[0]).toMatchObject({
      action: 'create-area',
      confidence: 0.9,
    });
  });

  it('sets lower confidence and derive-sku policy when the preview has blocking SKU conflicts', () => {
    const proposal = makeProductImportProposal(
      preview({
        duplicateSkuConflicts: [
          { sku: 'SKU-1', rows: [2, 3], names: ['One', 'Two'] },
        ],
        warnings: [
          {
            severity: 'error',
            field: 'sku',
            message: 'Duplicate SKU conflict',
          },
        ],
      }),
    );

    expect(proposal.confidence).toBe(0.72);
    expect(proposal.productIdentity).toEqual({
      sourceColumn: 'SID',
      conflictPolicy: 'derive-sku',
    });
    expect(proposal.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message:
            'This proposal is generated from structured CSV analysis and must be reviewed before import.',
        }),
      ]),
    );
  });
});
