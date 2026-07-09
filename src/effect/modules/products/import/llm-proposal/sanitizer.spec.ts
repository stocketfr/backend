import type { ProductImportPreviewDto } from '@stocket/types/products';
import { extractResponseText, sanitizeLlmProposal } from './sanitizer';

const preview: ProductImportPreviewDto = {
  format: 'sortly-items',
  totalRows: 3,
  itemRows: 2,
  folderRows: 1,
  importableRows: 1,
  missingRequiredRows: 0,
  duplicateSkuConflicts: [],
  categoryMappings: [
    {
      sourcePath: 'Accessories / Dental',
      targetPath: 'Accessories / Dental',
      action: 'create',
      rowCount: 2,
    },
  ],
  supplierMappings: [],
  locationMappings: [
    {
      sourceLocation: 'Bay I - Shelf 3',
      areaPath: 'Bay I / Shelf 3',
      action: 'create-area',
      confidence: 0.9,
      rowCount: 2,
    },
  ],
  inventoryPreviews: [],
  warnings: [
    {
      severity: 'error',
      field: 'sku',
      message: 'Duplicate SKU conflict',
    },
  ],
};

describe('extractResponseText', () => {
  it('reads direct output_text responses', () => {
    expect(extractResponseText({ output_text: '{"ok":true}' })).toBe(
      '{"ok":true}',
    );
  });

  it('reads nested content text responses', () => {
    expect(
      extractResponseText({
        output: [{ content: [{ text: '{"nested":true}' }] }],
      }),
    ).toBe('{"nested":true}');
  });

  it('fails when the response does not contain text', () => {
    expect(() => extractResponseText({ output: [] })).toThrow(
      'OpenAI response did not include output text',
    );
  });
});

describe('sanitizeLlmProposal', () => {
  it('repairs malformed fields and keeps only preview-backed mappings', () => {
    const proposal = sanitizeLlmProposal(
      {
        format: 'hallucinated-format',
        confidence: 3,
        productIdentity: {
          sourceColumn: '  ',
          conflictPolicy: 'overwrite',
        },
        categoryMappings: [
          {
            sourcePath: 'Accessories / Dental',
            targetPath: '  ',
            action: 'rename',
            rowCount: 999,
          },
          {
            sourcePath: 'Hallucinated Source',
            targetPath: 'Ignored',
            action: 'create',
            rowCount: 1,
          },
        ],
        supplierMappings: [
          {
            sourcePattern: 'Dental',
            supplierName: 'Dental Supplier',
            action: 'rename',
            confidence: -2,
            rowCount: -1,
          },
        ],
        locationMappings: [
          {
            sourceLocation: 'Bay I - Shelf 3',
            targetLocationName: '  ',
            areaPath: '  ',
            action: 'teleport',
            confidence: 2,
            rowCount: 999,
          },
        ],
        warnings: [
          {
            row: 1.5,
            field: ' category_path ',
            severity: 'panic',
            message: '  Needs review. ',
          },
        ],
      },
      preview,
    );

    expect(proposal).toMatchObject({
      format: 'sortly-items',
      confidence: 1,
      productIdentity: {
        sourceColumn: 'SID',
        conflictPolicy: 'reject',
      },
      categoryMappings: [
        {
          sourcePath: 'Accessories / Dental',
          targetPath: 'Accessories / Dental',
          action: 'create',
          rowCount: 2,
        },
      ],
      supplierMappings: [
        {
          sourcePattern: 'Dental',
          supplierName: 'Dental Supplier',
          action: 'ignore',
          confidence: 0,
          rowCount: 0,
        },
      ],
      locationMappings: [
        {
          sourceLocation: 'Bay I - Shelf 3',
          action: 'create-area',
          confidence: 1,
          rowCount: 2,
        },
      ],
    });
    expect(proposal.locationMappings[0]).not.toHaveProperty(
      'targetLocationName',
    );
    expect(proposal.locationMappings[0]).not.toHaveProperty('areaPath');
    expect(proposal.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'error', field: 'sku' }),
        expect.objectContaining({
          severity: 'warning',
          field: 'category_path',
          message: 'Needs review.',
        }),
      ]),
    );
  });
});
