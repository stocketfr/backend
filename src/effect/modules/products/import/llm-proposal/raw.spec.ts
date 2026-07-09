import { decodeRawLlmProposal } from './raw';

describe('decodeRawLlmProposal', () => {
  it('falls back to an empty proposal for non-object input', () => {
    expect(decodeRawLlmProposal('not-json-object')).toEqual({
      format: undefined,
      confidence: undefined,
      productIdentity: {
        sourceColumn: '',
        conflictPolicy: undefined,
      },
      categoryMappings: [],
      supplierMappings: [],
      locationMappings: [],
      warnings: [],
    });
  });

  it('trims strings and preserves recognized literals and finite numbers', () => {
    const proposal = decodeRawLlmProposal({
      format: 'normalized-products',
      confidence: 0.75,
      productIdentity: {
        sourceColumn: ' SKU ',
        conflictPolicy: 'derive-sku',
      },
      categoryMappings: [
        {
          sourcePath: ' Dental ',
          targetPath: ' Consumables / Dental ',
          action: 'use-existing',
          rowCount: 3,
        },
      ],
      supplierMappings: [
        {
          sourcePattern: ' Brand A ',
          supplierName: ' Supplier A ',
          action: 'create',
          confidence: 0.6,
          rowCount: 5,
        },
      ],
      locationMappings: [
        {
          sourceLocation: ' Shelf 1 ',
          targetLocationName: ' Main Shelf ',
          areaPath: ' Warehouse / Shelf 1 ',
          action: 'create-location',
          confidence: 0.8,
          rowCount: 4,
        },
      ],
      warnings: [
        {
          row: 2,
          field: ' sku ',
          severity: 'error',
          message: ' Duplicate SKU ',
        },
      ],
    });

    expect(proposal).toEqual({
      format: 'normalized-products',
      confidence: 0.75,
      productIdentity: {
        sourceColumn: 'SKU',
        conflictPolicy: 'derive-sku',
      },
      categoryMappings: [
        {
          sourcePath: 'Dental',
          targetPath: 'Consumables / Dental',
          action: 'use-existing',
          rowCount: 3,
        },
      ],
      supplierMappings: [
        {
          sourcePattern: 'Brand A',
          supplierName: 'Supplier A',
          action: 'create',
          confidence: 0.6,
          rowCount: 5,
        },
      ],
      locationMappings: [
        {
          sourceLocation: 'Shelf 1',
          targetLocationName: 'Main Shelf',
          areaPath: 'Warehouse / Shelf 1',
          action: 'create-location',
          confidence: 0.8,
          rowCount: 4,
        },
      ],
      warnings: [
        {
          row: 2,
          field: 'sku',
          severity: 'error',
          message: 'Duplicate SKU',
        },
      ],
    });
  });

  it('filters non-record array entries and defaults invalid field values', () => {
    const proposal = decodeRawLlmProposal({
      format: 'hallucinated',
      confidence: Number.POSITIVE_INFINITY,
      productIdentity: 'invalid',
      categoryMappings: [
        'skip me',
        {
          sourcePath: ' Dental ',
          targetPath: 123,
          action: 'rename',
          rowCount: -1,
        },
      ],
      supplierMappings: [
        null,
        {
          sourcePattern: ' Brand A ',
          supplierName: ' Supplier A ',
          action: 'merge',
          confidence: Number.NaN,
          rowCount: 1.5,
        },
      ],
      locationMappings: [
        [],
        {
          sourceLocation: ' Shelf 1 ',
          targetLocationName: false,
          areaPath: ' Warehouse ',
          action: 'teleport',
          confidence: -0.25,
          rowCount: -10,
        },
      ],
      warnings: [
        42,
        {
          row: -1,
          field: ' sku ',
          severity: 'critical',
          message: ' Needs review ',
        },
      ],
    });

    expect(proposal).toEqual({
      format: undefined,
      confidence: undefined,
      productIdentity: {
        sourceColumn: '',
        conflictPolicy: undefined,
      },
      categoryMappings: [
        {
          sourcePath: 'Dental',
          targetPath: '',
          action: undefined,
          rowCount: undefined,
        },
      ],
      supplierMappings: [
        {
          sourcePattern: 'Brand A',
          supplierName: 'Supplier A',
          action: undefined,
          confidence: undefined,
          rowCount: undefined,
        },
      ],
      locationMappings: [
        {
          sourceLocation: 'Shelf 1',
          targetLocationName: '',
          areaPath: 'Warehouse',
          action: undefined,
          confidence: -0.25,
          rowCount: undefined,
        },
      ],
      warnings: [
        {
          row: undefined,
          field: 'sku',
          severity: undefined,
          message: 'Needs review',
        },
      ],
    });
  });
});
