import { LocationType } from '@stocket/types/locations';
import type { ProductImportPreviewDto } from '../types';
import {
  categoryDecisionKey,
  locationDecisionKey,
  skuConflictDecisionKey,
} from './proposal-keys';
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
