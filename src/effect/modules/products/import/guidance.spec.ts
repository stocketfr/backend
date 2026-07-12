import { Effect } from 'effect';
import { LocationType } from '@stocket/types/locations';
import type {
  ProductImportPreviewDto,
  ProductImportSkuConflictResolutionV2Dto,
  ProductImportTargetContextDto,
} from '@stocket/types/products';
import { validateProductImportGuidance } from './guidance';
import { makeProductImportProposal } from './utils/proposal';

const preview: ProductImportPreviewDto = {
  format: 'normalized-products',
  totalRows: 1,
  itemRows: 1,
  folderRows: 0,
  photoUrlCount: 0,
  importableRows: 1,
  missingRequiredRows: 0,
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
  categoryMappings: [
    {
      sourcePath: 'Dental',
      targetPath: 'Dental',
      action: 'create',
      rowCount: 1,
    },
  ],
  supplierMappings: [],
  locationMappings: [
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
      row: 4,
      sku: 'SKU-2',
      location: '',
      quantity: 1,
      action: 'skip',
      reason: 'Missing location',
    },
  ],
  warnings: [],
};

const context: ProductImportTargetContextDto = {
  categories: [{ id: 'category-existing', path: 'Consumables / Dental' }],
  locations: [
    {
      id: 'location-existing',
      name: 'Warehouse',
      type: LocationType.WAREHOUSE,
    },
  ],
  areas: [
    {
      id: 'area-existing',
      locationId: 'location-existing',
      path: 'Bay I / Shelf 3',
    },
  ],
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

  it('rejects a photo-policy lock when currentPlan has no photo choice', async () => {
    const baseline = makeProductImportProposal(preview, context);

    await expect(
      Effect.runPromise(
        Effect.flip(
          validateProductImportGuidance(
            {
              currentPlan: toCurrentPlan(baseline),
              locks: { photoPolicy: true },
            },
            baseline,
            context,
          ),
        ),
      ),
    ).resolves.toMatchObject({ _tag: 'ProductImportProposalInvalid' });
  });

  it('accepts and preserves a locked photo choice in currentPlan', async () => {
    const baseline = makeProductImportProposal(preview, context);
    const currentPlan = {
      ...toCurrentPlan(baseline),
      photoPolicy: 'skip' as const,
    };

    const guidance = await Effect.runPromise(
      validateProductImportGuidance(
        { currentPlan, locks: { photoPolicy: true } },
        baseline,
        context,
      ),
    );

    expect(guidance?.currentPlan?.photoPolicy).toBe('skip');
    expect(guidance?.locks?.photoPolicy).toBe(true);
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

  it('requires exact source coverage and canonical server binding', async () => {
    const baseline = makeProductImportProposal(preview, context);
    const plan = toCurrentPlan(baseline);
    const [categoryMapping] = plan.categoryMappings;
    if (!categoryMapping) throw new Error('Expected category mapping');
    const invalidPlans = [
      { ...plan, categoryMappings: [] },
      {
        ...plan,
        categoryMappings: [categoryMapping, categoryMapping],
      },
      {
        ...plan,
        categoryMappings: [
          { ...categoryMapping, mappingKey: 'category:forged' },
        ],
      },
      {
        ...plan,
        categoryMappings: [{ ...categoryMapping, rowCount: 100 }],
      },
      {
        ...plan,
        categoryMappings: [
          {
            ...categoryMapping,
            targetPath: `${'x'.repeat(101)} / Dental`,
          },
        ],
      },
    ];

    for (const currentPlan of invalidPlans) {
      await expect(
        Effect.runPromise(
          Effect.flip(
            validateProductImportGuidance({ currentPlan }, baseline, context),
          ),
        ),
      ).resolves.toMatchObject({ _tag: 'ProductImportProposalInvalid' });
    }
  });

  it('requires canonical conflict identity, variants, rows, and bounded SKUs', async () => {
    const baseline = makeProductImportProposal(preview, context);
    const plan = toCurrentPlan(baseline);
    const [resolution] = plan.skuConflictResolutions;
    if (!resolution) throw new Error('Expected conflict resolution');
    const [firstVariant, secondVariant] = resolution.variants;
    if (!firstVariant || !secondVariant) throw new Error('Expected variants');
    const invalidResolutions: ProductImportSkuConflictResolutionV2Dto[] = [
      { ...resolution, sourceSku: 'forged' },
      { ...resolution, mappingKey: 'sku-conflict:forged' },
      { ...resolution, variants: [firstVariant] },
      {
        ...resolution,
        variants: [{ ...firstVariant, rows: [999] }, secondVariant],
      },
      {
        ...resolution,
        variants: [
          firstVariant,
          {
            ...secondVariant,
            action: 'custom-sku',
            targetSku: 'x'.repeat(51),
          },
        ],
      },
    ];

    for (const invalidResolution of invalidResolutions) {
      await expect(
        Effect.runPromise(
          Effect.flip(
            validateProductImportGuidance(
              {
                currentPlan: {
                  ...plan,
                  skuConflictResolutions: [invalidResolution],
                },
              },
              baseline,
              context,
            ),
          ),
        ),
      ).resolves.toMatchObject({ _tag: 'ProductImportProposalInvalid' });
    }
  });

  it('binds the missing-location singleton key and row count', async () => {
    const baseline = makeProductImportProposal(preview, context);
    const plan = toCurrentPlan(baseline);
    for (const missingLocationStrategy of [
      {
        ...plan.missingLocationStrategy,
        mappingKey: 'missing-location:forged',
      },
      { ...plan.missingLocationStrategy, rowCount: 999 },
    ]) {
      await expect(
        Effect.runPromise(
          Effect.flip(
            validateProductImportGuidance(
              {
                currentPlan: { ...plan, missingLocationStrategy },
              },
              baseline,
              context,
            ),
          ),
        ),
      ).resolves.toMatchObject({ _tag: 'ProductImportProposalInvalid' });
    }
  });

  it('rejects duplicate or nested child-area names in an editable shelf setup', async () => {
    const baseline = makeProductImportProposal(preview, context);
    const plan = toCurrentPlan(baseline);
    const [locationMapping] = plan.locationMappings;
    if (!locationMapping || locationMapping.action !== 'use-existing-area') {
      throw new Error('Expected an existing-area mapping');
    }

    for (const childAreas of [
      [{ name: 'Bin 1' }, { name: 'Bin 1' }],
      [{ name: 'Bin 1 / Nested' }],
    ]) {
      await expect(
        Effect.runPromise(
          Effect.flip(
            validateProductImportGuidance(
              {
                currentPlan: {
                  ...plan,
                  locationMappings: [{ ...locationMapping, childAreas }],
                },
              },
              baseline,
              context,
            ),
          ),
        ),
      ).resolves.toMatchObject({ _tag: 'ProductImportProposalInvalid' });
    }
  });
});
