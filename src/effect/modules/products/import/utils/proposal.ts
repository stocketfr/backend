import type {
  ProductImportAiProposalV2Dto,
  ProductImportCategoryMappingV2Dto,
  ProductImportChildAreaDto,
  ProductImportLocationMappingDto,
  ProductImportLocationMappingV2Dto,
  ProductImportPlanDto,
  ProductImportPreviewDto,
  ProductImportProposalGuidanceDto,
  ProductImportSkuConflictResolutionV2Dto,
  ProductImportSkuVariantResolutionDto,
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
import {
  normalizeProductImportAreaName,
  normalizeProductImportLocationName,
  normalizeProductImportPath,
  normalizeProductImportSku,
} from './proposal-values';
import { makeImportWarning } from './warnings';

const EMPTY_TARGET_CONTEXT: ProductImportTargetContextDto = {
  categories: [],
  locations: [],
  areas: [],
};

const fourBinChildAreas = ['Bin 1', 'Bin 2', 'Bin 3', 'Bin 4'].map(
  (name): ProductImportChildAreaDto => ({ name }),
);

const mapEntry = <K, V>(key: K, value: V): readonly [K, V] => [key, value];

const inferTargetCategoryPath = (sourcePath: string): string => {
  const normalized = normalizeCategoryPath(sourcePath);
  const lower = normalized.toLowerCase();

  if (normalized === 'Uncategorized') return 'Uncategorized';
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

const splitImportedAreaTarget = (
  areaPath: string,
): { readonly targetLocationName: string; readonly areaPath: string } => {
  const [root, ...rest] = areaPath
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  return {
    targetLocationName: root ?? areaPath,
    areaPath: rest.join(' / ') || 'Unassigned / Needs Review',
  };
};

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
    const usesUncategorizedFallback =
      normalizeCategoryPath(mapping.sourcePath) === 'Uncategorized';
    const inferredTargetPath = inferTargetCategoryPath(mapping.sourcePath);
    const targetPath =
      normalizeProductImportPath(inferredTargetPath) ?? 'Uncategorized';
    const existing =
      categoriesByPath.get(normalizedKey(targetPath)) ??
      categoriesByPath.get(normalizedKey(mapping.sourcePath));
    const metadata = {
      mappingKey: categoryDecisionKey(mapping.sourcePath),
      confidence: existing
        ? 0.98
        : usesUncategorizedFallback
          ? 0.5
          : context.truncated
            ? 0.55
            : 0.82,
      reason: existing
        ? 'Matches an existing tenant category path.'
        : usesUncategorizedFallback
          ? 'No source category was provided; uses the explicit Uncategorized fallback.'
          : 'Uses the inferred category hierarchy from the CSV source.',
      reviewRequired:
        !usesUncategorizedFallback && context.truncated === true && !existing,
      sourcePath: mapping.sourcePath,
      targetPath: existing?.path ?? targetPath,
      rowCount: mapping.rowCount,
    };

    return existing
      ? { ...metadata, action: 'use-existing', targetCategoryId: existing.id }
      : {
          ...metadata,
          action: usesUncategorizedFallback ? 'default' : 'create',
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
    const safeTargetLocationName =
      normalizeProductImportLocationName(sourceLocation) ??
      sourceLocation.slice(0, 100).trim();
    const safeAreaPath = mapping.areaPath
      ? (normalizeProductImportPath(mapping.areaPath) ??
        'Unassigned / Needs Review')
      : undefined;
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

    if (safeAreaPath) {
      const matchingArea = context.locations.flatMap((location) => {
        const area = areasByPath.get(
          `${location.id}:${normalizedKey(safeAreaPath)}`,
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
        areaPath: safeAreaPath,
        rowCount: mapping.rowCount,
      };
      if (onlyLocation) {
        return {
          ...metadata,
          action: 'create-area',
          targetLocationId: onlyLocation.id,
        };
      }

      const importedTarget = splitImportedAreaTarget(safeAreaPath);
      return {
        ...metadata,
        reason:
          'Uses the first imported path segment as the location and keeps the remaining hierarchy as areas.',
        action: 'create-area',
        targetLocationName: importedTarget.targetLocationName,
        areaPath: importedTarget.areaPath,
      };
    }

    return {
      mappingKey,
      confidence: context.truncated ? 0.55 : 0.75,
      reason: 'No existing location matches this CSV source.',
      reviewRequired: context.truncated === true,
      sourceLocation,
      action: 'create-location',
      targetLocationName: safeTargetLocationName,
      rowCount: mapping.rowCount,
    };
  });
};

const requestsFourBinsPerShelf = (instructions: string | undefined) => {
  if (!instructions) return false;
  const normalized = instructions.toLowerCase();
  if (
    /\b(?:do not|don't|dont|never)\s+(?:\w+\s+){0,6}(?:create|add|make)\b[^.]{0,80}\bbins?\b/.test(
      normalized,
    ) ||
    /\bno\s+(?:\w+\s+){0,3}bins?\b/.test(normalized)
  ) {
    return false;
  }
  return (
    /\bshel(?:f|ves)\b/.test(normalized) &&
    /\bbins?\b/.test(normalized) &&
    /\b(?:4|four)\b/.test(normalized)
  );
};

const isTerminalShelfPath = (areaPath: string | undefined) => {
  const terminal = areaPath?.split('/').at(-1)?.trim() ?? '';
  return /\bshelf\b/i.test(terminal);
};

const applyDeterministicAreaGuidance = (
  mappings: readonly ProductImportLocationMappingV2Dto[],
  instructions: string | undefined,
): ProductImportLocationMappingV2Dto[] => {
  if (!requestsFourBinsPerShelf(instructions)) return [...mappings];

  return mappings.map((mapping) =>
    (mapping.action === 'create-area' ||
      mapping.action === 'use-existing-area') &&
    isTerminalShelfPath(mapping.areaPath)
      ? { ...mapping, childAreas: fourBinChildAreas }
      : mapping,
  );
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

    const validSourceSku = normalizeProductImportSku(conflict.sku);
    return {
      mappingKey: conflictKey,
      confidence: 0.9,
      reason: 'Each distinct product definition needs its own editable SKU.',
      reviewRequired: true,
      conflictKey,
      sourceSku: conflict.sku,
      variants: variants.map((variant, index) =>
        index === 0 && validSourceSku
          ? {
              variantKey: variant.variantKey,
              rows: variant.rows,
              action: 'keep-source-sku',
              targetSku: validSourceSku,
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
  locationMappings: readonly ProductImportLocationMappingV2Dto[],
): ProductImportAiProposalV2Dto['missingLocationStrategy'] => {
  const rowCount = preview.inventoryPreviews.filter(
    (item) => item.location.trim() === '',
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
    const existingReviewLocation = context.locations.find(
      (location) => location.id === existingReviewArea.locationId,
    );
    return {
      mappingKey: MISSING_LOCATION_DECISION_KEY,
      confidence: 0.98,
      reason: 'Reuses the existing tenant review area.',
      reviewRequired: true,
      rowCount,
      action: 'use-existing-area',
      targetLocationId: existingReviewArea.locationId,
      ...(existingReviewLocation
        ? { targetLocationName: existingReviewLocation.name }
        : {}),
      targetAreaId: existingReviewArea.id,
      areaPath: existingReviewArea.path,
    };
  }

  const onlyLocation =
    context.locations.length === 1 ? context.locations[0] : undefined;
  const importedLocationName = locationMappings.find(
    (mapping) =>
      (mapping.action === 'create-location' ||
        mapping.action === 'create-area') &&
      mapping.targetLocationName,
  )?.targetLocationName;
  const mappedExistingLocationId = locationMappings.find(
    (mapping) => mapping.targetLocationId,
  )?.targetLocationId;
  const metadata = {
    mappingKey: MISSING_LOCATION_DECISION_KEY,
    confidence: onlyLocation || importedLocationName ? 0.9 : 0.65,
    reason: onlyLocation
      ? 'Keeps unlocated inventory visible beneath the only active location.'
      : importedLocationName
        ? 'Keeps unlocated inventory visible beneath a location created by this import.'
        : mappedExistingLocationId
          ? 'Keeps unlocated inventory visible beneath a location already selected by this import.'
          : 'No safe inventory destination could be inferred.',
    reviewRequired: true,
    rowCount,
    areaPath: 'Unassigned / Needs Review',
  };
  const existingLocationId = onlyLocation?.id ?? mappedExistingLocationId;
  if (existingLocationId) {
    return {
      ...metadata,
      action: 'assign-review-area',
      targetLocationId: existingLocationId,
    };
  }
  if (importedLocationName) {
    return {
      ...metadata,
      action: 'assign-review-area',
      targetLocationName: importedLocationName,
    };
  }
  return {
    mappingKey: metadata.mappingKey,
    confidence: metadata.confidence,
    reason: metadata.reason,
    reviewRequired: true,
    rowCount,
    action: 'skip-inventory',
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
  context: ProductImportTargetContextDto,
): ProductImportCategoryMappingV2Dto => {
  const category = mapping.targetCategoryId
    ? context.categories.find(
        (candidate) => candidate.id === mapping.targetCategoryId,
      )
    : undefined;
  const targetPath = normalizeProductImportPath(mapping.targetPath);
  const metadata = {
    mappingKey: fallback.mappingKey,
    confidence: mapping.confidence ?? fallback.confidence,
    ...(mapping.reason ? { reason: mapping.reason } : {}),
    reviewRequired: mapping.reviewRequired ?? fallback.reviewRequired,
    sourcePath: fallback.sourcePath,
    targetPath: category?.path ?? targetPath ?? fallback.targetPath,
    rowCount: fallback.rowCount,
  };
  if (mapping.action === 'use-existing') {
    return category
      ? {
          ...metadata,
          action: 'use-existing',
          targetCategoryId: category.id,
        }
      : fallback;
  }
  return targetPath
    ? {
        ...metadata,
        action: mapping.action === 'default' ? 'default' : 'create',
      }
    : fallback;
};

const normalizeLockedLocation = (
  mapping: ProductImportLocationMappingDto | ProductImportLocationMappingV2Dto,
  fallback: ProductImportLocationMappingV2Dto,
  context: ProductImportTargetContextDto,
): ProductImportLocationMappingV2Dto => {
  const location = mapping.targetLocationId
    ? context.locations.find(
        (candidate) => candidate.id === mapping.targetLocationId,
      )
    : undefined;
  const area = mapping.targetAreaId
    ? context.areas.find((candidate) => candidate.id === mapping.targetAreaId)
    : undefined;
  const areaPath = mapping.areaPath
    ? normalizeProductImportPath(mapping.areaPath)
    : undefined;
  const targetLocationName = mapping.targetLocationName
    ? normalizeProductImportLocationName(mapping.targetLocationName)
    : undefined;
  const childAreas =
    'childAreas' in mapping
      ? mapping.childAreas?.flatMap((child) => {
          const name = normalizeProductImportAreaName(child.name);
          return name ? [{ name }] : [];
        })
      : undefined;
  const childAreaSetup = childAreas === undefined ? {} : { childAreas };
  const metadata = {
    mappingKey: fallback.mappingKey,
    confidence: mapping.confidence ?? fallback.confidence,
    ...(mapping.reason ? { reason: mapping.reason } : {}),
    reviewRequired: mapping.reviewRequired ?? fallback.reviewRequired,
    sourceLocation: fallback.sourceLocation,
    rowCount: fallback.rowCount,
  };
  if (area && location && area.locationId === location.id) {
    return {
      ...metadata,
      ...childAreaSetup,
      action: 'use-existing-area',
      targetLocationId: location.id,
      targetLocationName: location.name,
      targetAreaId: area.id,
      areaPath: area.path,
    };
  }
  if (mapping.action === 'use-existing' && location) {
    return {
      ...metadata,
      action: 'use-existing',
      targetLocationId: location.id,
      targetLocationName: location.name,
    };
  }
  if (mapping.action === 'create-location' && targetLocationName) {
    return {
      ...metadata,
      action: 'create-location',
      targetLocationName,
    };
  }
  if (mapping.action === 'create-area' && areaPath) {
    if (location) {
      return {
        ...metadata,
        ...childAreaSetup,
        action: 'create-area',
        targetLocationId: location.id,
        areaPath,
      };
    }
    if (targetLocationName) {
      return {
        ...metadata,
        ...childAreaSetup,
        action: 'create-area',
        targetLocationName,
        areaPath,
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
  context: ProductImportTargetContextDto,
): ProductImportAiProposalV2Dto['missingLocationStrategy'] => {
  const location = strategy.targetLocationId
    ? context.locations.find(
        (candidate) => candidate.id === strategy.targetLocationId,
      )
    : undefined;
  const area = strategy.targetAreaId
    ? context.areas.find((candidate) => candidate.id === strategy.targetAreaId)
    : undefined;
  const areaPath = strategy.areaPath
    ? normalizeProductImportPath(strategy.areaPath)
    : undefined;
  const targetLocationName = strategy.targetLocationName
    ? normalizeProductImportLocationName(strategy.targetLocationName)
    : undefined;
  const metadata = {
    mappingKey: fallback.mappingKey,
    confidence: strategy.confidence ?? fallback.confidence,
    ...(strategy.reason ? { reason: strategy.reason } : {}),
    reviewRequired: strategy.reviewRequired ?? fallback.reviewRequired,
    rowCount: fallback.rowCount,
  };
  if (strategy.action === 'skip-inventory') {
    return { ...metadata, action: 'skip-inventory' };
  }
  if (
    strategy.action === 'use-existing-area' &&
    area &&
    location &&
    area.locationId === location.id
  ) {
    return {
      ...metadata,
      action: 'use-existing-area',
      targetLocationId: location.id,
      targetLocationName: location.name,
      targetAreaId: area.id,
      areaPath: area.path,
    };
  }
  if (strategy.action === 'assign-review-area' && location && areaPath) {
    return {
      ...metadata,
      action: 'assign-review-area',
      targetLocationId: location.id,
      areaPath,
    };
  }
  if (
    strategy.action === 'assign-review-area' &&
    targetLocationName &&
    areaPath
  ) {
    return {
      ...metadata,
      action: 'assign-review-area',
      targetLocationName,
      areaPath,
    };
  }
  return fallback;
};

const normalizeLockedSkuVariant = (
  edited: ProductImportSkuVariantResolutionDto,
  fallback: ProductImportSkuVariantResolutionDto,
  sourceSku: string,
): ProductImportSkuVariantResolutionDto => {
  if (edited.action === 'skip') {
    return {
      variantKey: fallback.variantKey,
      rows: fallback.rows,
      action: 'skip',
    };
  }
  const targetSku = normalizeProductImportSku(edited.targetSku);
  if (edited.action === 'keep-source-sku' && targetSku !== sourceSku) {
    return fallback;
  }
  return targetSku
    ? {
        variantKey: fallback.variantKey,
        rows: fallback.rows,
        action: edited.action,
        targetSku,
      }
    : fallback;
};

export const applyProductImportGuidanceLocks = (
  proposal: ProductImportAiProposalV2Dto,
  guidance: ProductImportProposalGuidanceDto | undefined,
): ProductImportAiProposalV2Dto => {
  const plan = guidance?.currentPlan;
  const locks = guidance?.locks;
  if (!plan || plan.planVersion !== 2) return proposal;
  const proposalWithPhotoPolicy = plan.photoPolicy
    ? { ...proposal, photoPolicy: plan.photoPolicy }
    : proposal;
  if (!locks) return proposalWithPhotoPolicy;
  const planLocationMappings:
    | readonly (
        | ProductImportLocationMappingDto
        | ProductImportLocationMappingV2Dto
      )[]
    | undefined = plan.locationMappings;

  const categoryMappings = lockedMappings(
    proposal.categoryMappings,
    plan.categoryMappings,
    locks.categoryMappings,
    (mapping, fallback) =>
      normalizeLockedCategory(mapping, fallback, proposal.targetContext),
  );
  const locationMappings = lockedMappings(
    proposal.locationMappings,
    planLocationMappings,
    locks.locationMappings,
    (mapping, fallback) =>
      normalizeLockedLocation(mapping, fallback, proposal.targetContext),
  );
  const skuConflictResolutions = lockedMappings(
    proposal.skuConflictResolutions,
    plan.skuConflictResolutions,
    locks.skuConflictResolutions,
    (mapping, fallback) => {
      const variantsByKey = new Map(
        mapping.variants.map((variant) =>
          mapEntry(variant.variantKey, variant),
        ),
      );
      return {
        ...fallback,
        confidence: mapping.confidence ?? fallback.confidence,
        ...(mapping.reason ? { reason: mapping.reason } : {}),
        reviewRequired: mapping.reviewRequired ?? fallback.reviewRequired,
        variants: fallback.variants.map((variant) => {
          const edited = variantsByKey.get(variant.variantKey);
          return edited
            ? normalizeLockedSkuVariant(edited, variant, fallback.sourceSku)
            : variant;
        }),
      };
    },
  );

  return {
    ...proposalWithPhotoPolicy,
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
            proposal.targetContext,
          )
        : proposal.missingLocationStrategy,
  };
};

export function makeProductImportProposal(
  preview: ProductImportPreviewDto,
  context: ProductImportTargetContextDto = EMPTY_TARGET_CONTEXT,
  guidance?: ProductImportProposalGuidanceDto,
): ProductImportAiProposalV2Dto {
  const locationMappings = applyDeterministicAreaGuidance(
    makeLocationMappings(preview, context),
    guidance?.instructions,
  );
  const warnings = [
    ...preview.warnings,
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
      missingLocationStrategy: makeMissingLocationStrategy(
        preview,
        context,
        locationMappings,
      ),
      categoryMappings: makeCategoryMappings(preview, context),
      supplierMappings: [],
      locationMappings,
      warnings,
    },
    guidance,
  );
}
