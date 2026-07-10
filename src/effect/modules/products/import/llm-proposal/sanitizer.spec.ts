import { LocationType } from '@stocket/types/locations';
import type {
  ProductImportPreviewDto,
  ProductImportTargetContextDto,
} from '@stocket/types/products';
import { categoryDecisionKey } from '../utils/proposal-keys';
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

const context: ProductImportTargetContextDto = {
  categories: [{ id: 'cat-1', path: 'Guest Accessories / Dental' }],
  locations: [{ id: 'loc-1', name: 'Warehouse', type: LocationType.WAREHOUSE }],
  areas: [{ id: 'area-1', locationId: 'loc-1', path: 'Bay I / Shelf 3' }],
};

const rawProposal = () => ({
  format: 'sortly-items',
  confidence: 0.95,
  productIdentity: { sourceColumn: 'SID', conflictPolicy: 'reject' },
  skuConflictResolutions: [],
  missingLocationStrategy: {
    action: 'skip-inventory',
    targetLocationId: null,
    targetLocationName: null,
    targetAreaId: null,
    areaPath: null,
    confidence: 1,
    reason: null,
    reviewRequired: false,
  },
  categoryMappings: [
    {
      sourcePath: 'Accessories / Dental',
      targetCategoryId: 'hallucinated-category',
      targetPath: 'Hallucinated',
      action: 'use-existing',
      confidence: 1,
      reason: null,
      reviewRequired: false,
    },
    {
      sourcePath: 'Hallucinated Source',
      targetCategoryId: null,
      targetPath: 'Ignored',
      action: 'create',
      confidence: 1,
      reason: null,
      reviewRequired: false,
    },
  ],
  supplierMappings: [{ ignored: true }],
  locationMappings: [
    {
      sourceLocation: 'Bay I - Shelf 3',
      targetLocationId: 'loc-1',
      targetLocationName: null,
      targetAreaId: 'hallucinated-area',
      areaPath: 'Bay I / Shelf 3',
      action: 'use-existing-area',
      confidence: 1,
      reason: null,
      reviewRequired: false,
    },
  ],
  warnings: [
    {
      row: null,
      field: ' category_path ',
      severity: 'warning',
      message: ' Review taxonomy. ',
    },
  ],
});

describe('extractResponseText', () => {
  it('reads direct and nested Responses API text', () => {
    expect(extractResponseText({ output_text: '{"ok":true}' })).toBe(
      '{"ok":true}',
    );
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
  it('drops hallucinated sources, IDs, and suppliers while preserving coverage', () => {
    const proposal = sanitizeLlmProposal(rawProposal(), preview, context);

    expect(proposal).toMatchObject({
      planVersion: 2,
      proposalSource: 'ai',
      supplierMappings: [],
    });
    expect(proposal.categoryMappings).toEqual([
      expect.objectContaining({
        sourcePath: 'Accessories / Dental',
        action: 'use-existing',
        targetCategoryId: 'cat-1',
        reviewRequired: true,
      }),
    ]);
    expect(proposal.locationMappings).toEqual([
      expect.objectContaining({
        sourceLocation: 'Bay I - Shelf 3',
        action: 'use-existing-area',
        targetAreaId: 'area-1',
        reviewRequired: true,
      }),
    ]);
  });

  it('reapplies locked user decisions after sanitizing AI output', () => {
    const mappingKey = categoryDecisionKey('Accessories / Dental');
    const proposal = sanitizeLlmProposal(rawProposal(), preview, context, {
      currentPlan: {
        planVersion: 2,
        skuConflictPolicy: 'reject',
        skuConflictResolutions: [],
        missingLocationStrategy: {
          mappingKey: 'missing-location',
          confidence: 1,
          reviewRequired: false,
          rowCount: 0,
          action: 'skip-inventory',
        },
        categoryMappings: [
          {
            mappingKey,
            confidence: 1,
            reviewRequired: false,
            sourcePath: 'Accessories / Dental',
            targetPath: 'User Locked / Dental',
            rowCount: 2,
            action: 'create',
          },
        ],
        locationMappings: [],
      },
      locks: { categoryMappings: [mappingKey] },
    });

    expect(proposal.categoryMappings[0]).toMatchObject({
      mappingKey,
      targetPath: 'User Locked / Dental',
      action: 'create',
    });
  });
});
