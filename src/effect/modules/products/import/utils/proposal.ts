import type {
  ProductImportAiProposalV2Dto,
  ProductImportCategoryMappingV2Dto,
  ProductImportLocationMappingV2Dto,
  ProductImportPlanDto,
  ProductImportPreviewDto,
  ProductImportProposalGuidanceDto,
  ProductImportSkuConflictResolutionV2Dto,
  ProductImportTargetContextDto,
} from '@stocket/types/products';
import { normalizeStorageLocationName } from '../storage-location/utils';
import { normalizeCategoryPath } from './csv';
import {
  categoryDecisionKey,
  locationDecisionKey,
  MISSING_LOCATION_DECISION_KEY,
  skuConflictDecisionKey,
  skuVariantDecisionKey,
} from './proposal-keys';
import { makeImportWarning } from './warnings';

const EMPTY_TARGET_CONTEXT: ProductImportTargetContextDto = {
  categories: [],
  locations: [],
  areas: [],
};

const importedLocationName = 'Imported Inventory';

const mapEntry = <K, V>(key: K, value: V): readonly [K, V] => [key, value];

const inferTargetCategoryPath = (sourcePath: string): string => {
  const normalized = normalizeCategoryPath(sourcePath);
  const lower = normalized.toLowerCase();

  if (normalized === 'Uncategorized') return 'Needs Review / Uncategorized';
  if (/\b(dental|toothbrush|toothpaste|mouthwash)\b/.test(lower)) {
    return 'Guest Accessories / Dental';
  }
  if (/\b(sunscreen|spf|sun stick|sun cream)\b/.test(lower)) {
    return 'Guest Accessories / Sunscreen';
  }
  if (/\b(nails?|manicure|pedicure)\b/.test(lower)) {
    return 'Spa Supplies / Nails';
  }
  if (/\b(wax|waxing)\b/.test(lower)) return 'Spa Supplies / Waxing';
  if (/\b(massage)\b/.test(lower)) return 'Spa Supplies / Massage';
  if (/\b(towels?|linens?)\b/.test(lower)) {
    return 'Spa Supplies / Towels & Linens';
  }
  if (/\b(shampoo)\b/.test(lower)) return 'Guest Amenities / Shampoo';
  if (/\b(conditioner)\b/.test(lower)) return 'Guest Amenities / Conditioner';
  if (/\b(body wash|shower gel)\b/.test(lower)) {
    return 'Guest Amenities / Body Wash';
  }
  if (/\b(hand wash|hand soap)\b/.test(lower)) {
    return 'Guest Amenities / Hand Wash';
  }
  if (/\b(body lotion|hand lotion|body balm)\b/.test(lower)) {
    return 'Guest Amenities / Lotions & Balms';
  }
  if (/\b(soap)\b/.test(lower)) return 'Guest Amenities / Soap';
  if (/\b(minis?)\b/.test(lower)) return 'Guest Amenities / Minis';
  if (/\b(bags?)\b/.test(lower)) return 'Guest Accessories / Bags';
  if (/\b(baskets?)\b/.test(lower)) return 'Housekeeping / Baskets';
  if (/\b(trays?)\b/.test(lower)) return 'Housekeeping / Trays';
  if (/\b(pillows?)\b/.test(lower)) return 'Housekeeping / Pillows';
  if (/\b(equipment)\b/.test(lower)) return 'Spa Supplies / Equipment';

  return normalized;
};

const normalizedKey = (value: string) => value.trim().toLowerCase();

const makeCategoryMappings = (
  preview: ProductImportPreviewDto,
  context: ProductImportTargetContextDto,
): ProductImportCategoryMappingV2Dto[] => {
  const categoriesByPath = new Map(
    context.categories.map((category) =>
      mapEntry(normalizedKey(category.path), category),
    ),
  );

  return preview.categoryMappings.map((mapping) => {
    const targetPath = inferTargetCategoryPath(mapping.sourcePath);
    const existing =
      categoriesByPath.get(normalizedKey(targetPath)) ??
      categoriesByPath.get(normalizedKey(mapping.sourcePath));
    const metadata = {
      mappingKey: categoryDecisionKey(mapping.sourcePath),
      confidence: existing ? 0.98 : context.truncated ? 0.55 : 0.82,
      reason: existing
        ? 'Matches an existing tenant category path.'
        : 'Uses the inferred category hierarchy from the CSV source.',
      reviewRequired:
        targetPath === 'Needs Review / Uncategorized' ||
        (context.truncated === true && !existing),
      sourcePath: mapping.sourcePath,
      targetPath: existing?.path ?? targetPath,
      rowCount: mapping.rowCount,
    };

    return existing
      ? { ...metadata, action: 'use-existing', targetCategoryId: existing.id }
      : {
          ...metadata,
          action:
            targetPath === 'Needs Review / Uncategorized'
              ? 'default'
              : 'create',
        };
  });
};

const makeLocationMappings = (
  preview: ProductImportPreviewDto,
  context: ProductImportTargetContextDto,
): ProductImportLocationMappingV2Dto[] => {
  const locationsByName = new Map(
    context.locations.map((location) =>
      mapEntry(normalizedKey(location.name), location),
    ),
  );
  const areasByPath = new Map(
    context.areas.map((area) =>
      mapEntry(`${area.locationId}:${normalizedKey(area.path)}`, area),
    ),
  );

  return preview.locationMappings.map((mapping) => {
    const sourceLocation = normalizeStorageLocationName(mapping.sourceLocation);
    const mappingKey = locationDecisionKey(sourceLocation);
    const exactLocation = locationsByName.get(normalizedKey(sourceLocation));
    if (exactLocation) {
      return {
        mappingKey,
        confidence: 0.98,
        reason: 'Matches an existing tenant location.',
        reviewRequired: false,
        sourceLocation,
        action: 'use-existing',
        targetLocationId: exactLocation.id,
        targetLocationName: exactLocation.name,
        rowCount: mapping.rowCount,
      };
    }

    if (mapping.areaPath) {
      const matchingArea = context.locations.flatMap((location) => {
        const area = areasByPath.get(
          `${location.id}:${normalizedKey(mapping.areaPath ?? '')}`,
        );
        return area ? [{ area, location }] : [];
      })[0];
      if (matchingArea) {
        return {
          mappingKey,
          confidence: 0.98,
          reason: 'Matches an existing tenant area path.',
          reviewRequired: false,
          sourceLocation,
          action: 'use-existing-area',
          targetLocationId: matchingArea.location.id,
          targetLocationName: matchingArea.location.name,
          targetAreaId: matchingArea.area.id,
          areaPath: matchingArea.area.path,
          rowCount: mapping.rowCount,
        };
      }

      const onlyLocation =
        context.locations.length === 1 ? context.locations[0] : undefined;
      const metadata = {
        mappingKey,
        confidence: onlyLocation ? 0.9 : 0.6,
        reason: onlyLocation
          ? 'The only active tenant location is the most likely area root.'
          : 'The CSV value is an area hierarchy but its root location needs review.',
        reviewRequired: !onlyLocation || context.truncated === true,
        sourceLocation,
        areaPath: mapping.areaPath,
        rowCount: mapping.rowCount,
      };
      return onlyLocation
        ? {
            ...metadata,
            action: 'create-area',
            targetLocationId: onlyLocation.id,
          }
        : {
            ...metadata,
            action: 'create-area',
            targetLocationName: importedLocationName,
          };
    }

    return {
      mappingKey,
      confidence: context.truncated ? 0.55 : 0.75,
      reason: 'No existing location matches this CSV source.',
      reviewRequired: context.truncated === true,
      sourceLocation,
      action: 'create-location',
      targetLocationName: sourceLocation,
      rowCount: mapping.rowCount,
    };
  });
};

const suggestedDerivedSku = (sourceSku: string, index: number) =>
  `${sourceSku}-${index + 1}`.slice(0, 50);

const makeSkuConflictResolutions = (
  preview: ProductImportPreviewDto,
): ProductImportSkuConflictResolutionV2Dto[] =>
  preview.duplicateSkuConflicts.map((conflict) => {
    const conflictKey =
      conflict.conflictKey ?? skuConflictDecisionKey(conflict.sku);
    const variants =
      conflict.variants ??
      conflict.names.map((name, index) => ({
        variantKey: skuVariantDecisionKey(
          conflictKey,
          `${name}:${conflict.rows[index] ?? index}`,
        ),
        rows: conflict.rows[index] === undefined ? [] : [conflict.rows[index]],
        names: [name],
      }));

    return {
      mappingKey: conflictKey,
      confidence: 0.9,
      reason: 'Each distinct product definition needs its own editable SKU.',
      reviewRequired: true,
      conflictKey,
      sourceSku: conflict.sku,
      variants: variants.map((variant, index) =>
        index === 0
          ? {
              variantKey: variant.variantKey,
              rows: variant.rows,
              action: 'keep-source-sku',
              targetSku: conflict.sku,
            }
          : {
              variantKey: variant.variantKey,
              rows: variant.rows,
              action: 'derive-sku',
              targetSku: suggestedDerivedSku(conflict.sku, index),
            },
      ),
    };
  });

const makeMissingLocationStrategy = (
  preview: ProductImportPreviewDto,
  context: ProductImportTargetContextDto,
): ProductImportAiProposalV2Dto['missingLocationStrategy'] => {
  const rowCount = preview.inventoryPreviews.filter(
    (item) => item.reason === 'Missing location',
  ).length;
  if (rowCount === 0) {
    return {
      mappingKey: MISSING_LOCATION_DECISION_KEY,
      confidence: 1,
      reason: 'Every import row already has a storage location.',
      reviewRequired: false,
      rowCount,
      action: 'skip-inventory',
    };
  }

  const existingReviewArea = context.areas.find(
    (area) => normalizedKey(area.path) === 'unassigned / needs review',
  );
  if (existingReviewArea) {
    return {
      mappingKey: MISSING_LOCATION_DECISION_KEY,
      confidence: 0.98,
      reason: 'Reuses the existing tenant review area.',
      reviewRequired: true,
      rowCount,
      action: 'use-existing-area',
      targetLocationId: existingReviewArea.locationId,
      targetAreaId: existingReviewArea.id,
      areaPath: existingReviewArea.path,
    };
  }

  const onlyLocation =
    context.locations.length === 1 ? context.locations[0] : undefined;
  const metadata = {
    mappingKey: MISSING_LOCATION_DECISION_KEY,
    confidence: onlyLocation ? 0.9 : 0.65,
    reason: onlyLocation
      ? 'Keeps unlocated inventory visible beneath the only active location.'
      : 'Keeps unlocated inventory visible without guessing a physical bay.',
    reviewRequired: true,
    rowCount,
    areaPath: 'Unassigned / Needs Review',
  };
  return onlyLocation
    ? {
        ...metadata,
        action: 'assign-review-area',
        targetLocationId: onlyLocation.id,
      }
    : {
        ...metadata,
        action: 'assign-review-area',
        targetLocationName: importedLocationName,
      };
};

const lockedMappings = <
  T extends { readonly mappingKey: string },
  P extends { readonly mappingKey?: string },
>(
  proposed: readonly T[],
  planMappings: readonly P[] | undefined,
  keys: readonly string[] | undefined,
  normalize: (mapping: P, fallback: T) => T,
): T[] => {
  if (!keys?.length || !planMappings) return [...proposed];
  const lockedKeys = new Set(keys);
  const planByKey = new Map(
    planMappings.flatMap((mapping) =>
      mapping.mappingKey ? [mapEntry(mapping.mappingKey, mapping)] : [],
    ),
  );
  return proposed.map((mapping) => {
    const edited = planByKey.get(mapping.mappingKey);
    return lockedKeys.has(mapping.mappingKey) && edited
      ? normalize(edited, mapping)
      : mapping;
  });
};

const normalizeLockedCategory = (
  mapping: NonNullable<ProductImportPlanDto['categoryMappings']>[number],
  fallback: ProductImportCategoryMappingV2Dto,
): ProductImportCategoryMappingV2Dto => {
  const metadata = {
    mappingKey: mapping.mappingKey ?? fallback.mappingKey,
    confidence: mapping.confidence ?? fallback.confidence,
    ...(mapping.reason ? { reason: mapping.reason } : {}),
    reviewRequired: mapping.reviewRequired ?? fallback.reviewRequired,
    sourcePath: mapping.sourcePath,
    targetPath: mapping.targetPath,
    rowCount: mapping.rowCount,
  };
  return mapping.action === 'use-existing' && mapping.targetCategoryId
    ? {
        ...metadata,
        action: 'use-existing',
        targetCategoryId: mapping.targetCategoryId,
      }
    : {
        ...metadata,
        action: mapping.action === 'default' ? 'default' : 'create',
      };
};

const normalizeLockedLocation = (
  mapping: NonNullable<ProductImportPlanDto['locationMappings']>[number],
  fallback: ProductImportLocationMappingV2Dto,
): ProductImportLocationMappingV2Dto => {
  const metadata = {
    mappingKey: mapping.mappingKey ?? fallback.mappingKey,
    confidence: mapping.confidence ?? fallback.confidence,
    ...(mapping.reason ? { reason: mapping.reason } : {}),
    reviewRequired: mapping.reviewRequired ?? fallback.reviewRequired,
    sourceLocation: mapping.sourceLocation,
    rowCount: mapping.rowCount,
  };
  if (mapping.targetAreaId && mapping.targetLocationId) {
    return {
      ...metadata,
      action: 'use-existing-area',
      targetLocationId: mapping.targetLocationId,
      ...(mapping.targetLocationName
        ? { targetLocationName: mapping.targetLocationName }
        : {}),
      targetAreaId: mapping.targetAreaId,
      ...(mapping.areaPath ? { areaPath: mapping.areaPath } : {}),
    };
  }
  if (mapping.action === 'use-existing' && mapping.targetLocationId) {
    return {
      ...metadata,
      action: 'use-existing',
      targetLocationId: mapping.targetLocationId,
      ...(mapping.targetLocationName
        ? { targetLocationName: mapping.targetLocationName }
        : {}),
    };
  }
  if (mapping.action === 'create-location' && mapping.targetLocationName) {
    return {
      ...metadata,
      action: 'create-location',
      targetLocationName: mapping.targetLocationName,
    };
  }
  if (mapping.action === 'create-area' && mapping.areaPath) {
    if (mapping.targetLocationId) {
      return {
        ...metadata,
        action: 'create-area',
        targetLocationId: mapping.targetLocationId,
        areaPath: mapping.areaPath,
      };
    }
    if (mapping.targetLocationName) {
      return {
        ...metadata,
        action: 'create-area',
        targetLocationName: mapping.targetLocationName,
        areaPath: mapping.areaPath,
      };
    }
  }
  return mapping.action === 'ignore'
    ? { ...metadata, action: 'ignore' }
    : fallback;
};

const normalizeLockedMissingLocation = (
  strategy: NonNullable<ProductImportPlanDto['missingLocationStrategy']>,
  fallback: ProductImportAiProposalV2Dto['missingLocationStrategy'],
): ProductImportAiProposalV2Dto['missingLocationStrategy'] => {
  const metadata = {
    mappingKey: strategy.mappingKey ?? fallback.mappingKey,
    confidence: strategy.confidence ?? fallback.confidence,
    ...(strategy.reason ? { reason: strategy.reason } : {}),
    reviewRequired: strategy.reviewRequired ?? fallback.reviewRequired,
    rowCount: strategy.rowCount,
  };
  if (strategy.action === 'skip-inventory') {
    return { ...metadata, action: 'skip-inventory' };
  }
  if (strategy.action === 'use-existing-area') {
    return {
      ...metadata,
      action: 'use-existing-area',
      targetLocationId: strategy.targetLocationId,
      ...(strategy.targetLocationName
        ? { targetLocationName: strategy.targetLocationName }
        : {}),
      targetAreaId: strategy.targetAreaId,
      ...(strategy.areaPath ? { areaPath: strategy.areaPath } : {}),
    };
  }
  if (strategy.targetLocationId) {
    return {
      ...metadata,
      action: 'assign-review-area',
      targetLocationId: strategy.targetLocationId,
      areaPath: strategy.areaPath,
    };
  }
  if (strategy.targetLocationName) {
    return {
      ...metadata,
      action: 'assign-review-area',
      targetLocationName: strategy.targetLocationName,
      areaPath: strategy.areaPath,
    };
  }
  return fallback;
};

export const applyProductImportGuidanceLocks = (
  proposal: ProductImportAiProposalV2Dto,
  guidance: ProductImportProposalGuidanceDto | undefined,
): ProductImportAiProposalV2Dto => {
  const plan = guidance?.currentPlan;
  const locks = guidance?.locks;
  if (!plan || !locks) return proposal;

  const categoryMappings = lockedMappings(
    proposal.categoryMappings,
    plan.categoryMappings,
    locks.categoryMappings,
    normalizeLockedCategory,
  );
  const locationMappings = lockedMappings(
    proposal.locationMappings,
    plan.locationMappings,
    locks.locationMappings,
    normalizeLockedLocation,
  );
  const skuConflictResolutions = lockedMappings(
    proposal.skuConflictResolutions,
    plan.skuConflictResolutions,
    locks.skuConflictResolutions,
    (mapping, fallback) => ({
      ...fallback,
      ...mapping,
      mappingKey: mapping.mappingKey ?? fallback.mappingKey,
      confidence: mapping.confidence ?? fallback.confidence,
      reviewRequired: mapping.reviewRequired ?? fallback.reviewRequired,
    }),
  );

  return {
    ...proposal,
    productIdentity:
      locks.skuConflictPolicy && plan.skuConflictPolicy
        ? {
            ...proposal.productIdentity,
            conflictPolicy: plan.skuConflictPolicy,
          }
        : proposal.productIdentity,
    categoryMappings,
    locationMappings,
    skuConflictResolutions,
    missingLocationStrategy:
      locks.missingLocationStrategy && plan.missingLocationStrategy
        ? normalizeLockedMissingLocation(
            plan.missingLocationStrategy,
            proposal.missingLocationStrategy,
          )
        : proposal.missingLocationStrategy,
  };
};

export function makeProductImportProposal(
  preview: ProductImportPreviewDto,
  context: ProductImportTargetContextDto = EMPTY_TARGET_CONTEXT,
  guidance?: ProductImportProposalGuidanceDto,
): ProductImportAiProposalV2Dto {
  const warnings = [
    ...preview.warnings,
    makeImportWarning(
      'This proposal is generated from structured CSV analysis and must be reviewed before import.',
    ),
    ...(context.truncated
      ? [
          makeImportWarning(
            'Existing category, location, or area context was truncated to safe proposal limits; unmatched decisions require review.',
          ),
        ]
      : []),
  ];

  return applyProductImportGuidanceLocks(
    {
      planVersion: 2,
      proposalSource: 'deterministic',
      format: preview.format,
      confidence: preview.warnings.some(
        (warning) => warning.severity === 'error',
      )
        ? 0.72
        : 0.84,
      productIdentity: {
        sourceColumn: preview.format === 'sortly-items' ? 'SID' : 'sku',
        conflictPolicy:
          preview.duplicateSkuConflicts.length > 0 ? 'derive-sku' : 'reject',
      },
      targetContext: context,
      skuConflictResolutions: makeSkuConflictResolutions(preview),
      missingLocationStrategy: makeMissingLocationStrategy(preview, context),
      categoryMappings: makeCategoryMappings(preview, context),
      supplierMappings: [],
      locationMappings: makeLocationMappings(preview, context),
      warnings,
    },
    guidance,
  );
}
