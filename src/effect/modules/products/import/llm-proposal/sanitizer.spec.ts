import { LocationType } from '@stocket/types/locations';
import type {
  ProductImportPreviewDto,
  ProductImportTargetContextDto,
} from '@stocket/types/products';
import type { NormalizedProductImportRow } from '../types';
import { categoryDecisionKey } from '../utils/proposal-keys';
import type { RawLlmProposal } from './raw';
import { sanitizeLlmProposal } from './sanitizer';

const normalizedRow = (
  sourceRow: number,
  name: string,
): NormalizedProductImportRow => ({
  sourceRow,
  sku: `SKU-${sourceRow}`,
  name,
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
});

const preview: ProductImportPreviewDto = {
  format: 'sortly-items',
  totalRows: 3,
  itemRows: 2,
  folderRows: 1,
  photoUrlCount: 1,
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

const rawProposal = (): RawLlmProposal => ({
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
      childAreas: [],
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

describe('sanitizeLlmProposal', () => {
  it('turns an unknowable category into an explicit automatic fallback', () => {
    const uncategorizedWarning = {
      severity: 'warning' as const,
      field: 'category_path',
      message:
        '2 rows have no category path. Smart Import will infer one from product details or use Uncategorized.',
    };
    const uncategorizedPreview: ProductImportPreviewDto = {
      ...preview,
      categoryMappings: [
        {
          sourcePath: 'Uncategorized',
          targetPath: 'Uncategorized',
          action: 'default',
          rowCount: 2,
        },
      ],
      warnings: [uncategorizedWarning],
    };
    const raw = rawProposal();
    const proposal = sanitizeLlmProposal(
      {
        ...raw,
        categoryMappings: [
          {
            sourcePath: 'Uncategorized',
            targetCategoryId: null,
            targetPath: 'Needs Review / Uncategorized',
            action: 'default',
            confidence: 0.2,
            reason: 'The examples are mixed.',
            reviewRequired: true,
          },
        ],
        warnings: [],
      },
      uncategorizedPreview,
      { ...context, categories: [] },
    );

    expect(proposal.categoryMappings).toEqual([
      expect.objectContaining({
        sourcePath: 'Uncategorized',
        targetPath: 'Uncategorized',
        action: 'default',
        reviewRequired: false,
      }),
    ]);
    expect(proposal.warnings).toContainEqual(uncategorizedWarning);
  });

  it('rejects a shared inferred category when Uncategorized evidence is incomplete', () => {
    const uncategorizedPreview: ProductImportPreviewDto = {
      ...preview,
      totalRows: 9,
      itemRows: 9,
      importableRows: 9,
      categoryMappings: [
        {
          sourcePath: 'Uncategorized',
          targetPath: 'Uncategorized',
          action: 'default',
          rowCount: 9,
        },
      ],
    };
    const raw = rawProposal();
    const proposal = sanitizeLlmProposal(
      {
        ...raw,
        categoryMappings: [
          {
            sourcePath: 'Uncategorized',
            targetCategoryId: 'cat-1',
            targetPath: 'Guest Accessories / Dental',
            action: 'use-existing',
            confidence: 0.99,
            reason: 'The first examples looked dental.',
            reviewRequired: false,
          },
        ],
      },
      uncategorizedPreview,
      context,
      undefined,
      Array.from({ length: 9 }, (_, index) =>
        normalizedRow(index + 2, `Product ${index + 1}`),
      ),
    );

    expect(proposal.categoryMappings).toEqual([
      expect.objectContaining({
        sourcePath: 'Uncategorized',
        action: 'default',
        targetPath: 'Uncategorized',
        reviewRequired: false,
      }),
    ]);
  });

  it('does not let a default action silently discard a known source category', () => {
    const raw = rawProposal();
    const proposal = sanitizeLlmProposal(
      {
        ...raw,
        categoryMappings: [
          {
            sourcePath: 'Accessories / Dental',
            targetCategoryId: null,
            targetPath: 'Uncategorized',
            action: 'default',
            confidence: 0.4,
            reason: 'Could not decide.',
            reviewRequired: false,
          },
        ],
      },
      preview,
      context,
    );

    expect(proposal.categoryMappings).toEqual([
      expect.objectContaining({
        sourcePath: 'Accessories / Dental',
        action: 'use-existing',
        targetCategoryId: 'cat-1',
        reviewRequired: true,
      }),
    ]);
  });

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

  it('uses canonical tenant display fields and the server-owned source column', () => {
    const raw = rawProposal();
    const [rawCategory] = raw.categoryMappings;
    const [rawLocation] = raw.locationMappings;
    if (!rawCategory || !rawLocation) throw new Error('Expected raw mappings');
    const proposal = sanitizeLlmProposal(
      {
        ...raw,
        productIdentity: {
          ...raw.productIdentity,
          sourceColumn: 'hallucinated-column',
        },
        categoryMappings: [
          {
            ...rawCategory,
            targetCategoryId: 'cat-1',
            targetPath: 'Spoofed Category Label',
          },
        ],
        locationMappings: [
          {
            ...rawLocation,
            targetAreaId: 'area-1',
            targetLocationName: 'Spoofed Warehouse',
            areaPath: 'Spoofed / Area',
          },
        ],
      },
      preview,
      context,
    );

    expect(proposal.productIdentity.sourceColumn).toBe('SID');
    expect(proposal.categoryMappings[0]).toMatchObject({
      targetCategoryId: 'cat-1',
      targetPath: 'Guest Accessories / Dental',
    });
    expect(proposal.locationMappings[0]).toMatchObject({
      targetLocationId: 'loc-1',
      targetLocationName: 'Warehouse',
      targetAreaId: 'area-1',
      areaPath: 'Bay I / Shelf 3',
    });
  });

  it('rejects a missing-stock location that the model did not map', () => {
    const importPreview: ProductImportPreviewDto = {
      ...preview,
      locationMappings: [
        {
          sourceLocation: 'North Store',
          targetLocationName: 'North Store',
          action: 'create-location',
          confidence: 0.8,
          rowCount: 1,
        },
      ],
      inventoryPreviews: [
        {
          row: 2,
          sku: 'UNLOCATED-001',
          location: '',
          quantity: 1,
          action: 'skip',
          reason: 'Missing location',
        },
      ],
    };
    const raw = rawProposal();
    const [rawLocation] = raw.locationMappings;
    if (!rawLocation) throw new Error('Expected raw location mapping');

    const proposal = sanitizeLlmProposal(
      {
        ...raw,
        missingLocationStrategy: {
          action: 'assign-review-area',
          targetLocationId: null,
          targetLocationName: 'Invented Holding Location',
          targetAreaId: null,
          areaPath: 'Unassigned / Needs Review',
          confidence: 0.9,
          reason: 'Temporary holding location.',
          reviewRequired: false,
        },
        locationMappings: [
          {
            ...rawLocation,
            sourceLocation: 'North Store',
            targetLocationId: null,
            targetLocationName: 'North Store',
            targetAreaId: null,
            areaPath: null,
            action: 'create-location',
          },
        ],
      },
      importPreview,
      { categories: [], locations: [], areas: [] },
    );

    expect(proposal.missingLocationStrategy).toMatchObject({
      action: 'assign-review-area',
      targetLocationName: 'North Store',
    });
    expect(proposal.missingLocationStrategy).not.toMatchObject({
      targetLocationName: 'Invented Holding Location',
    });
  });

  it('normalizes unique child areas while keeping the mapped shelf as the inventory target', () => {
    const raw = rawProposal();
    const [rawLocation] = raw.locationMappings;
    if (!rawLocation) throw new Error('Expected raw location mapping');

    const proposal = sanitizeLlmProposal(
      {
        ...raw,
        locationMappings: [
          {
            ...rawLocation,
            targetAreaId: 'area-1',
            childAreas: [
              { name: ' Bin 1 ' },
              { name: 'bin 1' },
              { name: 'Bad / Nested' },
              { name: 'Bin 2' },
            ],
          },
        ],
      },
      preview,
      context,
    );

    expect(proposal.locationMappings[0]).toMatchObject({
      action: 'use-existing-area',
      targetAreaId: 'area-1',
      areaPath: 'Bay I / Shelf 3',
      childAreas: [{ name: 'Bin 1' }, { name: 'Bin 2' }],
    });
  });

  it('rejects overlong model SKUs by retaining the deterministic variant', () => {
    const conflictPreview: ProductImportPreviewDto = {
      ...preview,
      duplicateSkuConflicts: [
        {
          conflictKey: 'sku-conflict:SKU-1',
          sku: 'SKU-1',
          rows: [2, 3],
          names: ['First', 'Second'],
          variants: [
            {
              variantKey: 'sku-conflict:SKU-1:variant:first',
              rows: [2],
              names: ['First'],
            },
            {
              variantKey: 'sku-conflict:SKU-1:variant:second',
              rows: [3],
              names: ['Second'],
            },
          ],
        },
      ],
    };
    const raw = rawProposal();
    const proposal = sanitizeLlmProposal(
      {
        ...raw,
        skuConflictResolutions: [
          {
            conflictKey: 'sku-conflict:SKU-1',
            confidence: 0.9,
            reason: null,
            reviewRequired: true,
            variants: [
              {
                variantKey: 'sku-conflict:SKU-1:variant:first',
                action: 'keep-source-sku',
                targetSku: 'SKU-1',
              },
              {
                variantKey: 'sku-conflict:SKU-1:variant:second',
                action: 'custom-sku',
                targetSku: 'x'.repeat(51),
              },
            ],
          },
        ],
      },
      conflictPreview,
      context,
    );

    const secondVariant = proposal.skuConflictResolutions[0]?.variants[1];
    expect(secondVariant).toMatchObject({
      variantKey: 'sku-conflict:SKU-1:variant:second',
      action: 'derive-sku',
      targetSku: 'SKU-1-2',
    });
  });
});
