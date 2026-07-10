import { Effect } from 'effect';
import type {
  ProductImportAiProposalV2Dto,
  ProductImportPlanDto,
  ProductImportProposalGuidanceDto,
  ProductImportTargetContextDto,
} from '@stocket/types/products';
import { ProductImportProposalInvalid } from '../products.errors';

const mapEntry = <K, V>(key: K, value: V): readonly [K, V] => [key, value];

const duplicateValues = (values: readonly string[]) => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
};

const mappingKeys = (
  mappings: readonly { readonly mappingKey?: string }[] | undefined,
) =>
  mappings?.flatMap((mapping) =>
    mapping.mappingKey ? [mapping.mappingKey] : [],
  ) ?? [];

const validateLockedKeys = (
  requested: readonly string[] | undefined,
  available: readonly string[],
  label: string,
  errors: string[],
) => {
  if (!requested) return;
  const availableKeys = new Set(available);
  for (const key of requested) {
    if (!availableKeys.has(key)) {
      errors.push(`Locked ${label} key "${key}" is not present in currentPlan`);
    }
  }
};

const validateTargetIds = (
  plan: ProductImportPlanDto,
  context: ProductImportTargetContextDto,
  errors: string[],
) => {
  const categoryIds = new Set(
    context.categories.map((category) => category.id),
  );
  const locationIds = new Set(context.locations.map((location) => location.id));
  const areaLocationById = new Map(
    context.areas.map((area) => mapEntry(area.id, area.locationId)),
  );

  for (const mapping of plan.categoryMappings ?? []) {
    if (
      mapping.action === 'use-existing' &&
      (!mapping.targetCategoryId || !categoryIds.has(mapping.targetCategoryId))
    ) {
      errors.push(
        `Category mapping "${mapping.sourcePath}" references an unknown category`,
      );
    }
  }

  for (const mapping of plan.locationMappings ?? []) {
    if (
      mapping.targetLocationId &&
      !locationIds.has(mapping.targetLocationId)
    ) {
      errors.push(
        `Location mapping "${mapping.sourceLocation}" references an unknown location`,
      );
    }
    if (mapping.targetAreaId) {
      const areaLocationId = areaLocationById.get(mapping.targetAreaId);
      if (!areaLocationId) {
        errors.push(
          `Location mapping "${mapping.sourceLocation}" references an unknown area`,
        );
      } else if (areaLocationId !== mapping.targetLocationId) {
        errors.push(
          `Location mapping "${mapping.sourceLocation}" references an area outside its location`,
        );
      }
    }
  }

  const missing = plan.missingLocationStrategy;
  if (missing?.targetLocationId && !locationIds.has(missing.targetLocationId)) {
    errors.push('Missing-location strategy references an unknown location');
  }
  if (missing?.targetAreaId) {
    const areaLocationId = areaLocationById.get(missing.targetAreaId);
    if (!areaLocationId) {
      errors.push('Missing-location strategy references an unknown area');
    } else if (areaLocationId !== missing.targetLocationId) {
      errors.push('Missing-location strategy area is outside its location');
    }
  }
};

const validateSourceCoverage = (
  plan: ProductImportPlanDto,
  baseline: ProductImportAiProposalV2Dto,
  errors: string[],
) => {
  const categorySources = new Set(
    baseline.categoryMappings.map((mapping) => mapping.sourcePath),
  );
  const locationSources = new Set(
    baseline.locationMappings.map((mapping) => mapping.sourceLocation),
  );
  const conflictsByKey = new Map(
    baseline.skuConflictResolutions.map((resolution) =>
      mapEntry(resolution.conflictKey, resolution),
    ),
  );

  for (const mapping of plan.categoryMappings ?? []) {
    if (!categorySources.has(mapping.sourcePath)) {
      errors.push(`Unknown category source "${mapping.sourcePath}"`);
    }
  }
  for (const mapping of plan.locationMappings ?? []) {
    if (!locationSources.has(mapping.sourceLocation)) {
      errors.push(`Unknown location source "${mapping.sourceLocation}"`);
    }
  }
  for (const resolution of plan.skuConflictResolutions ?? []) {
    const baselineResolution = conflictsByKey.get(resolution.conflictKey);
    if (!baselineResolution) {
      errors.push(`Unknown SKU conflict "${resolution.conflictKey}"`);
      continue;
    }
    const variantKeys = new Set(
      baselineResolution.variants.map((variant) => variant.variantKey),
    );
    for (const variant of resolution.variants) {
      if (!variantKeys.has(variant.variantKey)) {
        errors.push(`Unknown SKU conflict variant "${variant.variantKey}"`);
      }
    }
  }
};

export const validateProductImportGuidance = (
  guidance: ProductImportProposalGuidanceDto | undefined,
  baseline: ProductImportAiProposalV2Dto,
  context: ProductImportTargetContextDto,
) =>
  Effect.gen(function* () {
    if (!guidance) return undefined;
    const errors: string[] = [];
    const plan = guidance.currentPlan;
    const locks = guidance.locks;

    if (locks && !plan) {
      errors.push('Locked decisions require currentPlan');
    }

    if (plan) {
      const categoryKeys = mappingKeys(plan.categoryMappings);
      const locationKeys = mappingKeys(plan.locationMappings);
      const conflictKeys = mappingKeys(plan.skuConflictResolutions);
      for (const duplicate of duplicateValues([
        ...categoryKeys,
        ...locationKeys,
        ...conflictKeys,
      ])) {
        errors.push(`Duplicate decision mapping key "${duplicate}"`);
      }

      validateSourceCoverage(plan, baseline, errors);
      validateTargetIds(plan, context, errors);
      validateLockedKeys(
        locks?.categoryMappings,
        categoryKeys,
        'category mapping',
        errors,
      );
      validateLockedKeys(
        locks?.locationMappings,
        locationKeys,
        'location mapping',
        errors,
      );
      validateLockedKeys(
        locks?.skuConflictResolutions,
        conflictKeys,
        'SKU conflict',
        errors,
      );
      if (locks?.skuConflictPolicy && plan.skuConflictPolicy === undefined) {
        errors.push('Locked SKU conflict policy is absent from currentPlan');
      }
      if (
        locks?.missingLocationStrategy &&
        plan.missingLocationStrategy === undefined
      ) {
        errors.push(
          'Locked missing-location strategy is absent from currentPlan',
        );
      }
    }

    yield* Effect.succeed(errors).pipe(
      Effect.filterOrFail(
        (items) => items.length === 0,
        (items) =>
          new ProductImportProposalInvalid({
            cause: items.join('; '),
            messageKey: 'products.importProposalInvalid',
          }),
      ),
      Effect.asVoid,
    );
    return guidance;
  });
