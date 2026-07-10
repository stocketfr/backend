import { Effect } from 'effect';
import type { ProductImportPreviewDto } from '@stocket/types/products';
import { validateProductImportGuidance } from './guidance';
import { makeProductImportProposal } from './utils/proposal';

const preview: ProductImportPreviewDto = {
  format: 'normalized-products',
  totalRows: 1,
  itemRows: 1,
  folderRows: 0,
  importableRows: 1,
  missingRequiredRows: 0,
  duplicateSkuConflicts: [],
  categoryMappings: [
    {
      sourcePath: 'Dental',
      targetPath: 'Dental',
      action: 'create',
      rowCount: 1,
    },
  ],
  supplierMappings: [],
  locationMappings: [],
  inventoryPreviews: [],
  warnings: [],
};

const context = {
  categories: [{ id: 'category-existing', path: 'Consumables / Dental' }],
  locations: [],
  areas: [],
};

const toCurrentPlan = (
  proposal: ReturnType<typeof makeProductImportProposal>,
) => ({
  planVersion: 2 as const,
  skuConflictPolicy: proposal.productIdentity.conflictPolicy,
  skuConflictResolutions: proposal.skuConflictResolutions,
  missingLocationStrategy: proposal.missingLocationStrategy,
  categoryMappings: proposal.categoryMappings,
  locationMappings: proposal.locationMappings,
});

describe('validateProductImportGuidance', () => {
  it('rejects locks when no current plan is supplied', async () => {
    const baseline = makeProductImportProposal(preview, context);

    await expect(
      Effect.runPromise(
        Effect.flip(
          validateProductImportGuidance(
            { locks: { skuConflictPolicy: true } },
            baseline,
            context,
          ),
        ),
      ),
    ).resolves.toMatchObject({ _tag: 'ProductImportProposalInvalid' });
  });

  it('rejects user decisions that reference unknown target IDs', async () => {
    const baseline = makeProductImportProposal(preview, context);
    const baselinePlan = toCurrentPlan(baseline);
    const currentPlan = {
      ...baselinePlan,
      categoryMappings: baselinePlan.categoryMappings.map((mapping) => ({
        ...mapping,
        action: 'use-existing' as const,
        targetCategoryId: 'hallucinated-category',
      })),
    };

    await expect(
      Effect.runPromise(
        Effect.flip(
          validateProductImportGuidance({ currentPlan }, baseline, context),
        ),
      ),
    ).resolves.toMatchObject({ _tag: 'ProductImportProposalInvalid' });
  });

  it('accepts a known existing target and a matching locked mapping key', async () => {
    const baseline = makeProductImportProposal(preview, context);
    const baselinePlan = toCurrentPlan(baseline);
    const [baselineCategoryMapping] = baselinePlan.categoryMappings;
    if (!baselineCategoryMapping) throw new Error('Expected category mapping');
    const categoryMapping = {
      ...baselineCategoryMapping,
      action: 'use-existing' as const,
      targetCategoryId: 'category-existing',
      targetPath: 'Consumables / Dental',
    };
    const currentPlan = {
      ...baselinePlan,
      categoryMappings: [categoryMapping],
    };

    await expect(
      Effect.runPromise(
        validateProductImportGuidance(
          {
            currentPlan,
            locks: { categoryMappings: [categoryMapping.mappingKey] },
          },
          baseline,
          context,
        ),
      ),
    ).resolves.toMatchObject({ currentPlan });
  });
});
