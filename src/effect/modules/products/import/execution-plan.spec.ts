import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import type { ProductImportApprovedPlanV2Dto } from '@stocket/types/products';
import { LocationType } from '@stocket/types/locations';
import { validateProductImportExecutionPlan } from './execution-plan';
import type {
  ImportAreaRow,
  ImportCategoryRow,
  ImportLocationRow,
  NormalizedProductImportRow,
} from './types';
import type { ProductImportTargetRepository } from './targets/types';
import { findConflictingDuplicateSkuGroups } from './utils/duplicates';

const now = new Date('2026-01-01T00:00:00.000Z');

const row = (
  sourceRow: number,
  sku: string,
  name: string,
): NormalizedProductImportRow => ({
  sourceRow,
  sku,
  name,
  category_path: 'Supplies',
  reorder_point: '0',
  quantity: '1',
  location: 'Main Bay',
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

const category: ImportCategoryRow = {
  id: 'category-1',
  tenant_id: 'tenant-1',
  parent_id: null,
  name: 'Existing Supplies',
  description: null,
  created_at: now,
  updated_at: now,
};

const location: ImportLocationRow = {
  id: 'location-1',
  tenant_id: 'tenant-1',
  name: 'Main Warehouse',
  type: LocationType.WAREHOUSE,
  address: '',
  contact_person: '',
  phone: '',
  is_active: true,
  created_at: now,
  updated_at: now,
};

const area: ImportAreaRow = {
  id: 'area-1',
  tenant_id: 'tenant-1',
  location_id: location.id,
  parent_id: null,
  name: 'Main Bay',
  code: '',
  description: '',
  is_active: true,
  created_at: now,
  updated_at: now,
};

const makeRepository = (
  targets: {
    readonly location?: ImportLocationRow;
    readonly area?: ImportAreaRow;
  } = {},
) => {
  const targetLocation = targets.location ?? location;
  const targetArea = targets.area ?? area;
  return {
    findCategoryById: (id) =>
      Effect.succeed(id === category.id ? category : null),
    findCategoryByNameAndParent: () => Effect.succeed(null),
    createCategory: () => Effect.dieMessage('unexpected category create'),
    findLocationByName: () => Effect.succeed(null),
    findLocationById: (id) =>
      Effect.succeed(id === targetLocation.id ? targetLocation : null),
    createLocation: () => Effect.dieMessage('unexpected location create'),
    findAreaByNameLocationAndParent: () => Effect.succeed(null),
    findAreaById: (id) =>
      Effect.succeed(id === targetArea.id ? targetArea : null),
    createArea: () => Effect.dieMessage('unexpected area create'),
  } satisfies ProductImportTargetRepository;
};

const repository = makeRepository();

const makePlan = (
  rows: readonly NormalizedProductImportRow[],
  targetSkus: readonly [string, string],
): ProductImportApprovedPlanV2Dto => {
  const [conflict] = findConflictingDuplicateSkuGroups(rows, {
    includeReorderPoint: true,
  });
  if (
    !conflict?.conflictKey ||
    !conflict.variants?.[0] ||
    !conflict.variants[1]
  ) {
    throw new Error('Expected duplicate SKU fixture to contain two variants');
  }
  return {
    planVersion: 2,
    skuConflictPolicy: 'reject',
    skuConflictResolutions: [
      {
        mappingKey: conflict.conflictKey,
        confidence: 1,
        reviewRequired: false,
        conflictKey: conflict.conflictKey,
        sourceSku: conflict.sku,
        variants: [
          {
            variantKey: conflict.variants[0].variantKey,
            rows: conflict.variants[0].rows,
            action: 'custom-sku',
            targetSku: targetSkus[0],
          },
          {
            variantKey: conflict.variants[1].variantKey,
            rows: conflict.variants[1].rows,
            action: 'custom-sku',
            targetSku: targetSkus[1],
          },
        ],
      },
    ],
    missingLocationStrategy: {
      mappingKey: 'missing-location',
      confidence: 1,
      reviewRequired: false,
      rowCount: 0,
      action: 'skip-inventory',
    },
    categoryMappings: [
      {
        mappingKey: 'category:Supplies',
        confidence: 1,
        reviewRequired: false,
        sourcePath: 'Supplies',
        targetPath: 'Existing Supplies',
        targetCategoryId: category.id,
        action: 'use-existing',
        rowCount: rows.length,
      },
    ],
    locationMappings: [
      {
        mappingKey: 'location:Main%20Bay',
        confidence: 1,
        reviewRequired: false,
        sourceLocation: 'Main Bay',
        targetLocationId: location.id,
        targetAreaId: area.id,
        action: 'use-existing-area',
        rowCount: rows.length,
      },
    ],
  };
};

describe('validateProductImportExecutionPlan', () => {
  it.effect('maps every conflict variant to its editable target SKU', () =>
    Effect.gen(function* () {
      const rows = [row(2, 'DUP-1', 'Black'), row(3, 'DUP-1', 'White')];
      const decisions = yield* validateProductImportExecutionPlan({
        repository,
        rows,
        format: 'normalized-products',
        approvedPlan: makePlan(rows, ['DUP-BLACK', 'DUP-WHITE']),
      });

      expect(decisions.get(2)).toEqual({
        action: 'import',
        targetSku: 'DUP-BLACK',
      });
      expect(decisions.get(3)).toEqual({
        action: 'import',
        targetSku: 'DUP-WHITE',
      });
    }),
  );

  it.effect('rejects a target SKU already reserved by another product', () =>
    Effect.gen(function* () {
      const rows = [
        row(2, 'DUP-1', 'Black'),
        row(3, 'DUP-1', 'White'),
        row(4, 'RESERVED', 'Existing'),
      ];
      const plan = makePlan(rows, ['RESERVED', 'DUP-WHITE']);
      const error = yield* Effect.flip(
        validateProductImportExecutionPlan({
          repository,
          rows,
          format: 'normalized-products',
          approvedPlan: plan,
        }),
      );

      expect(error).toMatchObject({ _tag: 'ProductImportProposalInvalid' });
    }),
  );

  it.effect('rejects duplicate variant keys before applying decisions', () =>
    Effect.gen(function* () {
      const rows = [row(2, 'DUP-1', 'Black'), row(3, 'DUP-1', 'White')];
      const plan = makePlan(rows, ['DUP-BLACK', 'DUP-WHITE']);
      const resolution = plan.skuConflictResolutions[0];
      const firstVariant = resolution?.variants[0];
      if (!resolution || !firstVariant) {
        throw new Error('Expected conflict resolution fixture');
      }
      const invalidPlan = {
        ...plan,
        skuConflictResolutions: [
          {
            ...resolution,
            variants: [
              firstVariant,
              {
                variantKey: firstVariant.variantKey,
                rows: firstVariant.rows,
                action: 'custom-sku',
                targetSku: 'CONFLICTING-DECISION',
              },
              ...resolution.variants.slice(1),
            ],
          },
        ],
      } satisfies ProductImportApprovedPlanV2Dto;

      const error = yield* Effect.flip(
        validateProductImportExecutionPlan({
          repository,
          rows,
          format: 'normalized-products',
          approvedPlan: invalidPlan,
        }),
      );

      expect(error).toMatchObject({ _tag: 'ProductImportProposalInvalid' });
      expect(String(error.cause)).toContain('Duplicate SKU variant');
    }),
  );

  it.effect('rejects inactive existing locations before writes', () =>
    Effect.gen(function* () {
      const rows = [row(2, 'DUP-1', 'Black'), row(3, 'DUP-1', 'White')];
      const error = yield* Effect.flip(
        validateProductImportExecutionPlan({
          repository: makeRepository({
            location: { ...location, is_active: false },
          }),
          rows,
          format: 'normalized-products',
          approvedPlan: makePlan(rows, ['DUP-BLACK', 'DUP-WHITE']),
        }),
      );

      expect(String(error.cause)).toContain('inactive location');
    }),
  );

  it.effect('rejects inactive existing areas before writes', () =>
    Effect.gen(function* () {
      const rows = [row(2, 'DUP-1', 'Black'), row(3, 'DUP-1', 'White')];
      const error = yield* Effect.flip(
        validateProductImportExecutionPlan({
          repository: makeRepository({ area: { ...area, is_active: false } }),
          rows,
          format: 'normalized-products',
          approvedPlan: makePlan(rows, ['DUP-BLACK', 'DUP-WHITE']),
        }),
      );

      expect(String(error.cause)).toContain('inactive area');
    }),
  );
});
