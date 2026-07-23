import { LocationType } from '@stocket/types/locations';
import type { ProductImportPreviewDto } from '../types';
import {
  categoryDecisionKey,
  locationDecisionKey,
  skuConflictDecisionKey,
} from './proposal-keys';
import { makeProductImportPreview } from './preview';
import { makeProductImportProposal } from './proposal';

const preview = (
  overrides: Partial<ProductImportPreviewDto> = {},
): ProductImportPreviewDto => ({
  format: 'sortly-items',
  totalRows: 2,
  itemRows: 2,
  folderRows: 0,
  photoUrlCount: 0,
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

const context = {
  categories: [{ id: 'cat-dental', path: 'Guest Accessories / Dental' }],
  locations: [{ id: 'loc-1', name: 'Warehouse', type: LocationType.WAREHOUSE }],
  areas: [{ id: 'area-1', locationId: 'loc-1', path: 'Bay I / Shelf 3' }],
};

describe('makeProductImportProposal', () => {
  it('builds a complete deterministic v2 proposal using existing tenant targets', () => {
    const proposal = makeProductImportProposal(preview(), context);

    expect(proposal).toMatchObject({
      planVersion: 2,
      proposalSource: 'deterministic',
      targetContext: context,
      supplierMappings: [],
    });
    expect(proposal.categoryMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: 'Dental Care',
          targetPath: 'Guest Accessories / Dental',
          targetCategoryId: 'cat-dental',
          action: 'use-existing',
        }),
      ]),
    );
    expect(proposal.categoryMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: 'Uncategorized',
          targetPath: 'Uncategorized',
          action: 'default',
          reviewRequired: false,
        }),
      ]),
    );
    expect(proposal.locationMappings[0]).toMatchObject({
      action: 'use-existing-area',
      targetLocationId: 'loc-1',
      targetAreaId: 'area-1',
    });
  });

  it('marks unmatched decisions for review when tenant context was truncated', () => {
    const proposal = makeProductImportProposal(preview(), {
      categories: [],
      locations: [],
      areas: [],
      truncated: true,
    });

    expect(proposal.categoryMappings[0]?.reviewRequired).toBe(true);
    expect(proposal.locationMappings[0]?.reviewRequired).toBe(true);
    expect(proposal.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('context was truncated'),
        }),
      ]),
    );
  });

  it('counts every blank-location row even when another conflict owns its preview reason', () => {
    const proposal = makeProductImportProposal(
      preview({
        inventoryPreviews: [
          {
            row: 2,
            sku: 'DUPLICATE-001',
            location: '',
            quantity: 1,
            action: 'conflict',
            reason: 'Conflicting duplicate SKU',
          },
        ],
      }),
      context,
    );

    expect(proposal.missingLocationStrategy.rowCount).toBe(1);
  });

  it('warns neutrally and requires review when missing stock has no safe target', () => {
    const importPreview = makeProductImportPreview(
      [
        {
          sku: 'UNLOCATED-001',
          name: 'Unlocated Product',
          quantity: '1',
          location: '',
        },
      ],
      'normalized-products',
    );
    const proposal = makeProductImportProposal(importPreview, {
      categories: [],
      locations: [],
      areas: [],
    });

    expect(importPreview.warnings).toContainEqual(
      expect.objectContaining({
        field: 'location',
        message:
          '1 row has no storage location. Smart Import will propose whether to assign or skip inventory before import.',
      }),
    );
    expect(proposal.missingLocationStrategy).toEqual({
      mappingKey: 'missing-location',
      confidence: 0.65,
      reason: 'No safe inventory destination could be inferred.',
      reviewRequired: true,
      rowCount: 1,
      action: 'skip-inventory',
    });
  });

  it('places missing stock under a real location created by the import', () => {
    const proposal = makeProductImportProposal(
      preview({
        locationMappings: [
          {
            sourceLocation: 'North Store',
            targetLocationName: 'North Store',
            action: 'create-location',
            confidence: 0.8,
            rowCount: 1,
          },
          {
            sourceLocation: 'Bay I - Shelf 3',
            areaPath: 'Bay I / Shelf 3',
            action: 'create-area',
            confidence: 0.9,
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
      }),
      { categories: [], locations: [], areas: [] },
    );

    expect(proposal.missingLocationStrategy).toMatchObject({
      action: 'assign-review-area',
      targetLocationName: 'North Store',
      areaPath: 'Unassigned / Needs Review',
    });
    expect(
      proposal.locationMappings.map((mapping) => mapping.targetLocationName),
    ).not.toContain('Imported Inventory');
    expect(proposal.missingLocationStrategy).not.toMatchObject({
      targetLocationName: 'Imported Inventory',
    });
  });

  it('keeps missing-stock metadata aligned with its mapped existing destination', () => {
    const existingLocationMapping = {
      sourceLocation: 'Warehouse',
      targetLocationName: 'Warehouse',
      action: 'create-location' as const,
      confidence: 0.8,
      rowCount: 1,
    };
    const inventoryPreviews = [
      {
        row: 2,
        sku: 'UNLOCATED-001',
        location: '',
        quantity: 1,
        action: 'skip' as const,
        reason: 'Missing location',
      },
    ];
    const targetContext = {
      categories: [],
      locations: [
        {
          id: 'loc-warehouse',
          name: 'Warehouse',
          type: LocationType.WAREHOUSE,
        },
        {
          id: 'loc-annex',
          name: 'Annex',
          type: LocationType.WAREHOUSE,
        },
      ],
      areas: [],
    };
    const existingOnlyProposal = makeProductImportProposal(
      preview({
        locationMappings: [existingLocationMapping],
        inventoryPreviews,
      }),
      targetContext,
    );
    const mixedProposal = makeProductImportProposal(
      preview({
        locationMappings: [
          existingLocationMapping,
          {
            sourceLocation: 'North Store',
            targetLocationName: 'North Store',
            action: 'create-location',
            confidence: 0.8,
            rowCount: 1,
          },
        ],
        inventoryPreviews,
      }),
      targetContext,
    );

    expect(existingOnlyProposal.missingLocationStrategy.confidence).toBe(0.9);
    expect(mixedProposal.missingLocationStrategy).toMatchObject({
      action: 'assign-review-area',
      targetLocationId: 'loc-warehouse',
      confidence: 0.9,
      reason:
        'Keeps unlocated inventory visible beneath a location already selected by this import.',
    });
  });

  it('deterministically proposes four editable bins beneath terminal shelves', () => {
    const proposal = makeProductImportProposal(
      preview({
        locationMappings: [
          {
            sourceLocation: 'Bay I - Shelf 3',
            areaPath: 'Bay I / Shelf 3',
            action: 'create-area',
            confidence: 0.9,
            rowCount: 1,
          },
          {
            sourceLocation: 'Bay I - Shelf 3 - Bin A',
            areaPath: 'Bay I / Shelf 3 / Bin A',
            action: 'create-area',
            confidence: 0.9,
            rowCount: 1,
          },
        ],
      }),
      { categories: [], locations: [], areas: [] },
      {
        instructions:
          'For every shelf detected under every imported location, create four empty child bins named Bin 1, Bin 2, Bin 3, and Bin 4. Keep products assigned to their existing shelf unless the CSV explicitly names a bin.',
      },
    );

    expect(proposal.locationMappings[0]).toMatchObject({
      targetLocationName: 'Bay I',
      areaPath: 'Shelf 3',
      childAreas: [
        { name: 'Bin 1' },
        { name: 'Bin 2' },
        { name: 'Bin 3' },
        { name: 'Bin 4' },
      ],
    });
    expect(proposal.locationMappings[1]).not.toHaveProperty('childAreas');
  });

  it('does not turn a negated shelf instruction into structural changes', () => {
    const proposal = makeProductImportProposal(preview(), context, {
      instructions: 'Do not create four bins per shelf.',
    });

    expect(proposal.locationMappings[0]).not.toHaveProperty('childAreas');
  });

  it('preserves locked edited decisions in deterministic fallback', () => {
    const mappingKey = categoryDecisionKey('Dental Care');
    const baseline = makeProductImportProposal(preview(), context);
    const proposal = makeProductImportProposal(preview(), context, {
      currentPlan: {
        planVersion: 2,
        skuConflictPolicy: baseline.productIdentity.conflictPolicy,
        skuConflictResolutions: baseline.skuConflictResolutions,
        missingLocationStrategy: baseline.missingLocationStrategy,
        categoryMappings: baseline.categoryMappings.map((mapping) =>
          mapping.mappingKey === mappingKey
            ? {
                mappingKey: mapping.mappingKey,
                confidence: mapping.confidence,
                ...(mapping.reason ? { reason: mapping.reason } : {}),
                reviewRequired: mapping.reviewRequired,
                sourcePath: mapping.sourcePath,
                targetPath: 'Locked / Dental',
                action: 'create',
                rowCount: mapping.rowCount,
              }
            : mapping,
        ),
        locationMappings: baseline.locationMappings,
      },
      locks: { categoryMappings: [mappingKey] },
    });

    expect(proposal.categoryMappings[0]).toMatchObject({
      mappingKey,
      targetPath: 'Locked / Dental',
      action: 'create',
    });
  });

  it('preserves a locked photo policy across proposal refreshes', () => {
    const baseline = makeProductImportProposal(preview(), context);
    const currentPlan = {
      planVersion: 2 as const,
      photoPolicy: 'skip' as const,
      skuConflictPolicy: baseline.productIdentity.conflictPolicy,
      skuConflictResolutions: baseline.skuConflictResolutions,
      missingLocationStrategy: baseline.missingLocationStrategy,
      categoryMappings: baseline.categoryMappings,
      locationMappings: baseline.locationMappings,
    };
    const proposal = makeProductImportProposal(preview(), context, {
      currentPlan,
      locks: { photoPolicy: true },
    });
    const unlockedProposal = makeProductImportProposal(preview(), context, {
      currentPlan,
    });

    expect(proposal.photoPolicy).toBe('skip');
    expect(unlockedProposal.photoPolicy).toBe('skip');
  });

  it('preserves a locked client-edited child-area setup across guidance refresh', () => {
    const instructions = 'Create four bins per shelf.';
    const baseline = makeProductImportProposal(preview(), context, {
      instructions,
    });
    const [mapping] = baseline.locationMappings;
    if (!mapping || mapping.action !== 'use-existing-area') {
      throw new Error('Expected existing shelf mapping');
    }
    const currentPlan = {
      planVersion: 2 as const,
      skuConflictPolicy: baseline.productIdentity.conflictPolicy,
      skuConflictResolutions: baseline.skuConflictResolutions,
      missingLocationStrategy: baseline.missingLocationStrategy,
      categoryMappings: baseline.categoryMappings,
      locationMappings: [
        {
          ...mapping,
          childAreas: [{ name: 'Left Bin' }, { name: 'Right Bin' }],
        },
      ],
    };

    const refreshed = makeProductImportProposal(preview(), context, {
      instructions,
      currentPlan,
      locks: { locationMappings: [mapping.mappingKey] },
    });

    expect(refreshed.locationMappings[0]).toMatchObject({
      mappingKey: mapping.mappingKey,
      childAreas: [{ name: 'Left Bin' }, { name: 'Right Bin' }],
    });
  });

  it('keeps case-distinct source keys collision-free', () => {
    expect(categoryDecisionKey('Dental')).not.toBe(
      categoryDecisionKey('dental'),
    );
    expect(locationDecisionKey('Bay A')).not.toBe(locationDecisionKey('bay a'));
    expect(skuConflictDecisionKey('SKU-1')).not.toBe(
      skuConflictDecisionKey('sku-1'),
    );
  });

  it('never lets locked edits replace server-owned source fields', () => {
    const baseline = makeProductImportProposal(preview(), context);
    const [categoryMapping] = baseline.categoryMappings;
    if (!categoryMapping) throw new Error('Expected category mapping');
    const proposal = makeProductImportProposal(preview(), context, {
      currentPlan: {
        planVersion: 2,
        skuConflictPolicy: baseline.productIdentity.conflictPolicy,
        skuConflictResolutions: baseline.skuConflictResolutions,
        missingLocationStrategy: baseline.missingLocationStrategy,
        categoryMappings: [
          {
            ...categoryMapping,
            sourcePath: 'Tampered Source',
            rowCount: 9_999,
          },
          ...baseline.categoryMappings.slice(1),
        ],
        locationMappings: baseline.locationMappings,
      },
      locks: { categoryMappings: [categoryMapping.mappingKey] },
    });

    expect(proposal.categoryMappings[0]).toMatchObject({
      sourcePath: categoryMapping.sourcePath,
      rowCount: categoryMapping.rowCount,
      mappingKey: categoryMapping.mappingKey,
      targetPath: categoryMapping.targetPath,
    });
  });
});
