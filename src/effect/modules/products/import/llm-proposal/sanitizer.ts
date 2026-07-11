import type {
  ProductImportAiProposalV2Dto,
  ProductImportAreaTargetDto,
  ProductImportCategoryMappingV2Dto,
  ProductImportCategoryTargetDto,
  ProductImportLocationMappingV2Dto,
  ProductImportLocationTargetDto,
  ProductImportPreviewDto,
  ProductImportProposalGuidanceDto,
  ProductImportSkuConflictResolutionV2Dto,
  ProductImportSkuVariantResolutionDto,
  ProductImportTargetContextDto,
  ProductImportWarningDto,
} from '@stocket/types/products';
import {
  applyProductImportGuidanceLocks,
  makeProductImportProposal,
} from '../utils/proposal';
import type { RawLlmProposal } from './raw';
import {
  normalizeProductImportLocationName,
  normalizeProductImportPath,
  normalizeProductImportSku,
} from '../utils/proposal-values';

const mapEntry = <K, V>(key: K, value: V): readonly [K, V] => [key, value];

const clampConfidence = (value: number, fallback: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

const optionalReason = (reason: string | null) => {
  const trimmed = reason?.trim();
  return trimmed ? { reason: trimmed } : {};
};

const sanitizeWarnings = (
  llmWarnings: RawLlmProposal['warnings'],
  preview: ProductImportPreviewDto,
  fallback: ProductImportAiProposalV2Dto,
): ProductImportWarningDto[] => {
  const requiredPreviewWarnings = preview.warnings.filter(
    (warning) => warning.severity === 'error',
  );
  const proposalWarnings = fallback.warnings.filter(
    (warning) =>
      !preview.warnings.some(
        (previewWarning) => previewWarning.message === warning.message,
      ),
  );
  const sanitized = llmWarnings.flatMap((warning) => {
    const message = warning.message.trim();
    if (!message) return [];
    return [
      {
        ...(warning.row === null ? {} : { row: warning.row }),
        ...(warning.field?.trim() ? { field: warning.field.trim() } : {}),
        severity: warning.severity,
        message,
      },
    ];
  });
  return [...requiredPreviewWarnings, ...proposalWarnings, ...sanitized].slice(
    0,
    40,
  );
};

const sanitizeCategoryMapping = (
  raw: RawLlmProposal['categoryMappings'][number],
  fallback: ProductImportCategoryMappingV2Dto,
  categoriesById: ReadonlyMap<string, ProductImportCategoryTargetDto>,
): ProductImportCategoryMappingV2Dto => {
  const targetPath = normalizeProductImportPath(raw.targetPath);
  const metadata = {
    mappingKey: fallback.mappingKey,
    confidence: clampConfidence(raw.confidence, fallback.confidence),
    ...optionalReason(raw.reason),
    reviewRequired: raw.reviewRequired,
    sourcePath: fallback.sourcePath,
    targetPath: targetPath ?? fallback.targetPath,
    rowCount: fallback.rowCount,
  };
  if (raw.action === 'use-existing' && raw.targetCategoryId) {
    const category = categoriesById.get(raw.targetCategoryId);
    if (!category) return { ...fallback, reviewRequired: true };
    return {
      ...metadata,
      targetPath: category.path,
      action: 'use-existing',
      targetCategoryId: category.id,
    };
  }
  if (raw.action === 'create' || raw.action === 'default') {
    return targetPath
      ? { ...metadata, targetPath, action: raw.action }
      : { ...fallback, reviewRequired: true };
  }
  return { ...fallback, reviewRequired: true };
};

const sanitizeLocationMapping = (
  raw: RawLlmProposal['locationMappings'][number],
  fallback: ProductImportLocationMappingV2Dto,
  locationsById: ReadonlyMap<string, ProductImportLocationTargetDto>,
  areasById: ReadonlyMap<string, ProductImportAreaTargetDto>,
): ProductImportLocationMappingV2Dto => {
  const metadata = {
    mappingKey: fallback.mappingKey,
    confidence: clampConfidence(raw.confidence, fallback.confidence),
    ...optionalReason(raw.reason),
    reviewRequired: raw.reviewRequired,
    sourceLocation: fallback.sourceLocation,
    rowCount: fallback.rowCount,
  };
  if (raw.action === 'use-existing' && raw.targetLocationId) {
    const location = locationsById.get(raw.targetLocationId);
    if (!location) return { ...fallback, reviewRequired: true };
    return {
      ...metadata,
      action: 'use-existing',
      targetLocationId: location.id,
      targetLocationName: location.name,
    };
  }
  if (
    raw.action === 'use-existing-area' &&
    raw.targetLocationId &&
    raw.targetAreaId
  ) {
    const location = locationsById.get(raw.targetLocationId);
    const area = areasById.get(raw.targetAreaId);
    if (!location || !area || area.locationId !== location.id) {
      return { ...fallback, reviewRequired: true };
    }
    return {
      ...metadata,
      action: 'use-existing-area',
      targetLocationId: location.id,
      targetLocationName: location.name,
      targetAreaId: area.id,
      areaPath: area.path,
    };
  }
  const targetLocationName = raw.targetLocationName
    ? normalizeProductImportLocationName(raw.targetLocationName)
    : undefined;
  if (raw.action === 'create-location' && targetLocationName) {
    return {
      ...metadata,
      action: 'create-location',
      targetLocationName,
    };
  }
  const areaPath = raw.areaPath
    ? normalizeProductImportPath(raw.areaPath)
    : undefined;
  if (raw.action === 'create-area' && areaPath) {
    const location = raw.targetLocationId
      ? locationsById.get(raw.targetLocationId)
      : undefined;
    if (location) {
      return {
        ...metadata,
        action: 'create-area',
        targetLocationId: location.id,
        areaPath,
      };
    }
    if (targetLocationName) {
      return {
        ...metadata,
        action: 'create-area',
        targetLocationName,
        areaPath,
      };
    }
  }
  if (raw.action === 'ignore') return { ...metadata, action: 'ignore' };
  return { ...fallback, reviewRequired: true };
};

const sanitizeMissingLocationStrategy = (
  raw: RawLlmProposal['missingLocationStrategy'],
  fallback: ProductImportAiProposalV2Dto['missingLocationStrategy'],
  locationsById: ReadonlyMap<string, ProductImportLocationTargetDto>,
  areasById: ReadonlyMap<string, ProductImportAreaTargetDto>,
): ProductImportAiProposalV2Dto['missingLocationStrategy'] => {
  const metadata = {
    mappingKey: fallback.mappingKey,
    confidence: clampConfidence(raw.confidence, fallback.confidence),
    ...optionalReason(raw.reason),
    reviewRequired: raw.reviewRequired,
    rowCount: fallback.rowCount,
  };
  if (raw.action === 'skip-inventory') {
    return { ...metadata, action: 'skip-inventory' };
  }
  if (
    raw.action === 'use-existing-area' &&
    raw.targetLocationId &&
    raw.targetAreaId
  ) {
    const location = locationsById.get(raw.targetLocationId);
    const area = areasById.get(raw.targetAreaId);
    if (!location || !area || area.locationId !== location.id) {
      return { ...fallback, reviewRequired: true };
    }
    return {
      ...metadata,
      action: 'use-existing-area',
      targetLocationId: location.id,
      targetLocationName: location.name,
      targetAreaId: area.id,
      areaPath: area.path,
    };
  }
  const areaPath = raw.areaPath
    ? normalizeProductImportPath(raw.areaPath)
    : undefined;
  const targetLocationName = raw.targetLocationName
    ? normalizeProductImportLocationName(raw.targetLocationName)
    : undefined;
  if (raw.action === 'assign-review-area' && areaPath) {
    const location = raw.targetLocationId
      ? locationsById.get(raw.targetLocationId)
      : undefined;
    if (location) {
      return {
        ...metadata,
        action: 'assign-review-area',
        targetLocationId: location.id,
        areaPath,
      };
    }
    if (targetLocationName) {
      return {
        ...metadata,
        action: 'assign-review-area',
        targetLocationName,
        areaPath,
      };
    }
  }
  return { ...fallback, reviewRequired: true };
};

const sanitizeSkuVariant = (
  variant: ProductImportSkuVariantResolutionDto,
  rawVariant:
    | RawLlmProposal['skuConflictResolutions'][number]['variants'][number]
    | undefined,
  sourceSku: string,
): ProductImportSkuVariantResolutionDto => {
  if (!rawVariant) return variant;
  if (rawVariant.action === 'skip') {
    return {
      variantKey: variant.variantKey,
      rows: variant.rows,
      action: 'skip',
    };
  }
  const targetSku = rawVariant.targetSku
    ? normalizeProductImportSku(rawVariant.targetSku)
    : undefined;
  if (rawVariant.action === 'keep-source-sku' && targetSku !== sourceSku) {
    return variant;
  }
  return targetSku
    ? {
        variantKey: variant.variantKey,
        rows: variant.rows,
        action: rawVariant.action,
        targetSku,
      }
    : variant;
};

export const sanitizeLlmProposal = (
  proposal: RawLlmProposal,
  preview: ProductImportPreviewDto,
  context: ProductImportTargetContextDto,
  guidance?: ProductImportProposalGuidanceDto,
): ProductImportAiProposalV2Dto => {
  const fallback = makeProductImportProposal(preview, context);
  const categoriesById = new Map(
    context.categories.map((category) => mapEntry(category.id, category)),
  );
  const locationsById = new Map(
    context.locations.map((location) => mapEntry(location.id, location)),
  );
  const areasById = new Map(
    context.areas.map((area) => mapEntry(area.id, area)),
  );
  const rawCategoriesBySource = new Map(
    proposal.categoryMappings.map((mapping) =>
      mapEntry(mapping.sourcePath, mapping),
    ),
  );
  const categoryMappings = fallback.categoryMappings.map((mapping) => {
    const rawMapping = rawCategoriesBySource.get(mapping.sourcePath);
    return rawMapping
      ? sanitizeCategoryMapping(rawMapping, mapping, categoriesById)
      : mapping;
  });
  const rawLocationsBySource = new Map(
    proposal.locationMappings.map((mapping) =>
      mapEntry(mapping.sourceLocation, mapping),
    ),
  );
  const locationMappings = fallback.locationMappings.map((mapping) => {
    const rawMapping = rawLocationsBySource.get(mapping.sourceLocation);
    return rawMapping
      ? sanitizeLocationMapping(rawMapping, mapping, locationsById, areasById)
      : mapping;
  });
  const rawConflictsByKey = new Map(
    proposal.skuConflictResolutions.map((resolution) =>
      mapEntry(resolution.conflictKey, resolution),
    ),
  );
  const skuConflictResolutions = fallback.skuConflictResolutions.map(
    (resolution): ProductImportSkuConflictResolutionV2Dto => {
      const rawResolution = rawConflictsByKey.get(resolution.conflictKey);
      if (!rawResolution) return resolution;
      const rawVariantsByKey = new Map(
        rawResolution.variants.map((variant) =>
          mapEntry(variant.variantKey, variant),
        ),
      );
      return {
        ...resolution,
        confidence: clampConfidence(
          rawResolution.confidence,
          resolution.confidence,
        ),
        ...optionalReason(rawResolution.reason),
        reviewRequired: rawResolution.reviewRequired,
        variants: resolution.variants.map((variant) =>
          sanitizeSkuVariant(
            variant,
            rawVariantsByKey.get(variant.variantKey),
            resolution.sourceSku,
          ),
        ),
      };
    },
  );

  return applyProductImportGuidanceLocks(
    {
      ...fallback,
      proposalSource: 'ai',
      format: preview.format,
      confidence: clampConfidence(proposal.confidence, fallback.confidence),
      productIdentity: {
        sourceColumn: fallback.productIdentity.sourceColumn,
        conflictPolicy: proposal.productIdentity.conflictPolicy,
      },
      skuConflictResolutions,
      missingLocationStrategy: sanitizeMissingLocationStrategy(
        proposal.missingLocationStrategy,
        fallback.missingLocationStrategy,
        locationsById,
        areasById,
      ),
      categoryMappings,
      supplierMappings: [],
      locationMappings,
      warnings: sanitizeWarnings(proposal.warnings, preview, fallback),
    },
    guidance,
  );
};
