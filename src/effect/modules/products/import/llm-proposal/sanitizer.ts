import type {
  ProductImportAiProposalV2Dto,
  ProductImportCategoryMappingV2Dto,
  ProductImportLocationMappingV2Dto,
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
import { decodeRawLlmProposal, type RawLlmProposal } from './raw';
import { isUnknownRecord } from './shared';

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
  categoryIds: ReadonlySet<string>,
): ProductImportCategoryMappingV2Dto => {
  const metadata = {
    mappingKey: fallback.mappingKey,
    confidence: clampConfidence(raw.confidence, fallback.confidence),
    ...optionalReason(raw.reason),
    reviewRequired: raw.reviewRequired,
    sourcePath: fallback.sourcePath,
    targetPath: raw.targetPath.trim() || fallback.targetPath,
    rowCount: fallback.rowCount,
  };
  if (
    raw.action === 'use-existing' &&
    raw.targetCategoryId &&
    categoryIds.has(raw.targetCategoryId)
  ) {
    return {
      ...metadata,
      action: 'use-existing',
      targetCategoryId: raw.targetCategoryId,
    };
  }
  if (raw.action === 'create' || raw.action === 'default') {
    return { ...metadata, action: raw.action };
  }
  return { ...fallback, reviewRequired: true };
};

const sanitizeLocationMapping = (
  raw: RawLlmProposal['locationMappings'][number],
  fallback: ProductImportLocationMappingV2Dto,
  locationIds: ReadonlySet<string>,
  areaLocationById: ReadonlyMap<string, string>,
): ProductImportLocationMappingV2Dto => {
  const metadata = {
    mappingKey: fallback.mappingKey,
    confidence: clampConfidence(raw.confidence, fallback.confidence),
    ...optionalReason(raw.reason),
    reviewRequired: raw.reviewRequired,
    sourceLocation: fallback.sourceLocation,
    rowCount: fallback.rowCount,
  };
  if (
    raw.action === 'use-existing' &&
    raw.targetLocationId &&
    locationIds.has(raw.targetLocationId)
  ) {
    return {
      ...metadata,
      action: 'use-existing',
      targetLocationId: raw.targetLocationId,
      ...(raw.targetLocationName?.trim()
        ? { targetLocationName: raw.targetLocationName.trim() }
        : {}),
    };
  }
  if (
    raw.action === 'use-existing-area' &&
    raw.targetLocationId &&
    raw.targetAreaId &&
    locationIds.has(raw.targetLocationId) &&
    areaLocationById.get(raw.targetAreaId) === raw.targetLocationId
  ) {
    return {
      ...metadata,
      action: 'use-existing-area',
      targetLocationId: raw.targetLocationId,
      ...(raw.targetLocationName?.trim()
        ? { targetLocationName: raw.targetLocationName.trim() }
        : {}),
      targetAreaId: raw.targetAreaId,
      ...(raw.areaPath?.trim() ? { areaPath: raw.areaPath.trim() } : {}),
    };
  }
  if (raw.action === 'create-location' && raw.targetLocationName?.trim()) {
    return {
      ...metadata,
      action: 'create-location',
      targetLocationName: raw.targetLocationName.trim(),
    };
  }
  if (raw.action === 'create-area' && raw.areaPath?.trim()) {
    if (raw.targetLocationId && locationIds.has(raw.targetLocationId)) {
      return {
        ...metadata,
        action: 'create-area',
        targetLocationId: raw.targetLocationId,
        areaPath: raw.areaPath.trim(),
      };
    }
    if (raw.targetLocationName?.trim()) {
      return {
        ...metadata,
        action: 'create-area',
        targetLocationName: raw.targetLocationName.trim(),
        areaPath: raw.areaPath.trim(),
      };
    }
  }
  if (raw.action === 'ignore') return { ...metadata, action: 'ignore' };
  return { ...fallback, reviewRequired: true };
};

const sanitizeMissingLocationStrategy = (
  raw: RawLlmProposal['missingLocationStrategy'],
  fallback: ProductImportAiProposalV2Dto['missingLocationStrategy'],
  locationIds: ReadonlySet<string>,
  areaLocationById: ReadonlyMap<string, string>,
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
    raw.targetAreaId &&
    locationIds.has(raw.targetLocationId) &&
    areaLocationById.get(raw.targetAreaId) === raw.targetLocationId
  ) {
    return {
      ...metadata,
      action: 'use-existing-area',
      targetLocationId: raw.targetLocationId,
      ...(raw.targetLocationName?.trim()
        ? { targetLocationName: raw.targetLocationName.trim() }
        : {}),
      targetAreaId: raw.targetAreaId,
      ...(raw.areaPath?.trim() ? { areaPath: raw.areaPath.trim() } : {}),
    };
  }
  if (raw.action === 'assign-review-area' && raw.areaPath?.trim()) {
    if (raw.targetLocationId && locationIds.has(raw.targetLocationId)) {
      return {
        ...metadata,
        action: 'assign-review-area',
        targetLocationId: raw.targetLocationId,
        areaPath: raw.areaPath.trim(),
      };
    }
    if (raw.targetLocationName?.trim()) {
      return {
        ...metadata,
        action: 'assign-review-area',
        targetLocationName: raw.targetLocationName.trim(),
        areaPath: raw.areaPath.trim(),
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
): ProductImportSkuVariantResolutionDto => {
  if (!rawVariant) return variant;
  if (rawVariant.action === 'skip') {
    return {
      variantKey: variant.variantKey,
      rows: variant.rows,
      action: 'skip',
    };
  }
  const targetSku = rawVariant.targetSku?.trim();
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
  raw: unknown,
  preview: ProductImportPreviewDto,
  context: ProductImportTargetContextDto,
  guidance?: ProductImportProposalGuidanceDto,
): ProductImportAiProposalV2Dto => {
  const proposal = decodeRawLlmProposal(raw);
  const fallback = makeProductImportProposal(preview, context);
  const categoryIds = new Set(
    context.categories.map((category) => category.id),
  );
  const locationIds = new Set(context.locations.map((location) => location.id));
  const areaLocationById = new Map(
    context.areas.map((area) => mapEntry(area.id, area.locationId)),
  );
  const rawCategoriesBySource = new Map(
    proposal.categoryMappings.map((mapping) =>
      mapEntry(mapping.sourcePath, mapping),
    ),
  );
  const categoryMappings = fallback.categoryMappings.map((mapping) => {
    const rawMapping = rawCategoriesBySource.get(mapping.sourcePath);
    return rawMapping
      ? sanitizeCategoryMapping(rawMapping, mapping, categoryIds)
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
      ? sanitizeLocationMapping(
          rawMapping,
          mapping,
          locationIds,
          areaLocationById,
        )
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
          sanitizeSkuVariant(variant, rawVariantsByKey.get(variant.variantKey)),
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
        sourceColumn:
          proposal.productIdentity.sourceColumn.trim() ||
          fallback.productIdentity.sourceColumn,
        conflictPolicy: proposal.productIdentity.conflictPolicy,
      },
      skuConflictResolutions,
      missingLocationStrategy: sanitizeMissingLocationStrategy(
        proposal.missingLocationStrategy,
        fallback.missingLocationStrategy,
        locationIds,
        areaLocationById,
      ),
      categoryMappings,
      supplierMappings: [],
      locationMappings,
      warnings: sanitizeWarnings(proposal.warnings, preview, fallback),
    },
    guidance,
  );
};

export const extractResponseText = (json: unknown): string => {
  if (!isUnknownRecord(json)) {
    throw new Error('OpenAI response was not a JSON object');
  }

  if (typeof json.output_text === 'string') return json.output_text;
  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    if (!isUnknownRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isUnknownRecord(content)) continue;
      if (typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('OpenAI response did not include output text');
};
