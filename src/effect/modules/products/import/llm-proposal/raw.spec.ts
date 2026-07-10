import { decodeRawLlmProposal } from './raw';

const validRawProposal = {
  format: 'normalized-products',
  confidence: 0.75,
  productIdentity: {
    sourceColumn: 'sku',
    conflictPolicy: 'derive-sku',
  },
  skuConflictResolutions: [
    {
      conflictKey: 'sku-conflict:sku-1',
      confidence: 0.8,
      reason: null,
      reviewRequired: true,
      variants: [
        {
          variantKey: 'sku-conflict:sku-1:variant:first',
          action: 'derive-sku',
          targetSku: 'SKU-1-1',
        },
      ],
    },
  ],
  missingLocationStrategy: {
    action: 'assign-review-area',
    targetLocationId: null,
    targetLocationName: 'Imported Inventory',
    targetAreaId: null,
    areaPath: 'Unassigned / Needs Review',
    confidence: 0.6,
    reason: 'No source location was supplied.',
    reviewRequired: true,
  },
  categoryMappings: [
    {
      sourcePath: 'Dental',
      targetCategoryId: null,
      targetPath: 'Consumables / Dental',
      action: 'create',
      confidence: 0.7,
      reason: null,
      reviewRequired: true,
    },
  ],
  supplierMappings: [],
  locationMappings: [
    {
      sourceLocation: 'Shelf 1',
      targetLocationId: null,
      targetLocationName: 'Warehouse',
      targetAreaId: null,
      areaPath: 'Shelf 1',
      action: 'create-area',
      confidence: 0.8,
      reason: null,
      reviewRequired: true,
    },
  ],
  warnings: [
    {
      row: 2,
      field: 'sku',
      severity: 'warning',
      message: 'Duplicate SKU',
    },
  ],
} as const;

describe('decodeRawLlmProposal', () => {
  it('decodes a complete strict v2 proposal', () => {
    expect(decodeRawLlmProposal(validRawProposal)).toEqual(validRawProposal);
  });

  it('rejects non-object input', () => {
    expect(() => decodeRawLlmProposal('not-json-object')).toThrow();
  });

  it('rejects incomplete or semantically unknown output', () => {
    expect(() =>
      decodeRawLlmProposal({
        ...validRawProposal,
        format: 'hallucinated',
      }),
    ).toThrow();
    expect(() =>
      decodeRawLlmProposal({
        ...validRawProposal,
        skuConflictResolutions: undefined,
      }),
    ).toThrow();
  });
});
