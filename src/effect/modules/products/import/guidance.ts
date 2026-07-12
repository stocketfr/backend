import { Effect } from 'effect';
import type {
  ProductImportAiProposalV2Dto,
  ProductImportApprovedPlanV2Dto,
  ProductImportProposalGuidanceDto,
  ProductImportTargetContextDto,
} from '@stocket/types/products';
import { ProductImportProposalInvalid } from '../products.errors';
import {
  categoryDecisionKey,
  locationDecisionKey,
  MISSING_LOCATION_DECISION_KEY,
  skuConflictDecisionKey,
} from './utils/proposal-keys';
import {
  normalizeProductImportAreaName,
  normalizeProductImportLocationName,
  normalizeProductImportPath,
  normalizeProductImportSku,
} from './utils/proposal-values';

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

const validateNoDuplicates = (
  values: readonly string[],
  label: string,
  errors: string[],
) => {
  for (const duplicate of duplicateValues(values)) {
    errors.push(`Duplicate ${label} "${duplicate}"`);
  }
};

const validateExactCoverage = (
  expected: readonly string[],
  actual: readonly string[],
  label: string,
  errors: string[],
) => {
  validateNoDuplicates(actual, `${label} source`, errors);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  for (const value of expected) {
    if (!actualSet.has(value))
      errors.push(`Missing ${label} source "${value}"`);
  }
  for (const value of actual) {
    if (!expectedSet.has(value))
      errors.push(`Unknown ${label} source "${value}"`);
  }
};

const validateCanonicalPath = (
  value: string | undefined,
  label: string,
  errors: string[],
) => {
  if (value === undefined) return;
  if (normalizeProductImportPath(value) !== value) {
    errors.push(`${label} must be a normalized path within import limits`);
  }
};

const validateCanonicalLocationName = (
  value: string | undefined,
  label: string,
  errors: string[],
) => {
  if (value === undefined) return;
  if (normalizeProductImportLocationName(value) !== value) {
    errors.push(
      `${label} must be a normalized location name within import limits`,
    );
  }
};

const validateChildAreas = (
  childAreas: readonly { readonly name: string }[] | undefined,
  label: string,
  errors: string[],
) => {
  if (childAreas === undefined) return;
  if (childAreas.length > 20) {
    errors.push(`${label} cannot create more than 20 child areas`);
  }
  const normalizedNames: string[] = [];
  for (const child of childAreas) {
    const name = normalizeProductImportAreaName(child.name);
    if (name === undefined || name !== child.name) {
      errors.push(`${label} has an invalid child-area name`);
      continue;
    }
    normalizedNames.push(name.toLowerCase());
  }
  validateNoDuplicates(normalizedNames, `${label} child-area name`, errors);
};

const validateCategoryMappings = (
  plan: ProductImportApprovedPlanV2Dto,
  baseline: ProductImportAiProposalV2Dto,
  context: ProductImportTargetContextDto,
  errors: string[],
) => {
  validateExactCoverage(
    baseline.categoryMappings.map((mapping) => mapping.sourcePath),
    plan.categoryMappings.map((mapping) => mapping.sourcePath),
    'category',
    errors,
  );
  validateNoDuplicates(
    plan.categoryMappings.map((mapping) => mapping.mappingKey),
    'category mapping key',
    errors,
  );
  const baselineBySource = new Map(
    baseline.categoryMappings.map((mapping) =>
      mapEntry(mapping.sourcePath, mapping),
    ),
  );
  const categoriesById = new Map(
    context.categories.map((category) => mapEntry(category.id, category)),
  );

  for (const mapping of plan.categoryMappings) {
    const expected = baselineBySource.get(mapping.sourcePath);
    if (!expected) continue;
    const canonicalKey = categoryDecisionKey(expected.sourcePath);
    if (
      mapping.mappingKey !== canonicalKey ||
      mapping.mappingKey !== expected.mappingKey
    ) {
      errors.push(
        `Category mapping "${mapping.sourcePath}" has a non-canonical mapping key`,
      );
    }
    if (mapping.rowCount !== expected.rowCount) {
      errors.push(
        `Category mapping "${mapping.sourcePath}" has a non-canonical row count`,
      );
    }
    validateCanonicalPath(
      mapping.targetPath,
      `Category target for "${mapping.sourcePath}"`,
      errors,
    );
    if (mapping.action === 'use-existing') {
      const category = categoriesById.get(mapping.targetCategoryId);
      if (!category) {
        errors.push(
          `Category mapping "${mapping.sourcePath}" references an unknown category`,
        );
      } else if (mapping.targetPath !== category.path) {
        errors.push(
          `Category mapping "${mapping.sourcePath}" does not use the canonical category path`,
        );
      }
    }
  }
};

const validateLocationMappings = (
  plan: ProductImportApprovedPlanV2Dto,
  baseline: ProductImportAiProposalV2Dto,
  context: ProductImportTargetContextDto,
  errors: string[],
) => {
  validateExactCoverage(
    baseline.locationMappings.map((mapping) => mapping.sourceLocation),
    plan.locationMappings.map((mapping) => mapping.sourceLocation),
    'location',
    errors,
  );
  validateNoDuplicates(
    plan.locationMappings.map((mapping) => mapping.mappingKey),
    'location mapping key',
    errors,
  );
  const baselineBySource = new Map(
    baseline.locationMappings.map((mapping) =>
      mapEntry(mapping.sourceLocation, mapping),
    ),
  );
  const locationsById = new Map(
    context.locations.map((location) => mapEntry(location.id, location)),
  );
  const areasById = new Map(
    context.areas.map((area) => mapEntry(area.id, area)),
  );

  for (const mapping of plan.locationMappings) {
    const expected = baselineBySource.get(mapping.sourceLocation);
    if (!expected) continue;
    const canonicalKey = locationDecisionKey(expected.sourceLocation);
    if (
      mapping.mappingKey !== canonicalKey ||
      mapping.mappingKey !== expected.mappingKey
    ) {
      errors.push(
        `Location mapping "${mapping.sourceLocation}" has a non-canonical mapping key`,
      );
    }
    if (mapping.rowCount !== expected.rowCount) {
      errors.push(
        `Location mapping "${mapping.sourceLocation}" has a non-canonical row count`,
      );
    }
    validateCanonicalLocationName(
      mapping.targetLocationName,
      `Location target for "${mapping.sourceLocation}"`,
      errors,
    );
    validateCanonicalPath(
      mapping.areaPath,
      `Area target for "${mapping.sourceLocation}"`,
      errors,
    );
    if ('childAreas' in mapping) {
      validateChildAreas(
        mapping.childAreas,
        `Location mapping "${mapping.sourceLocation}"`,
        errors,
      );
    }

    if (mapping.action === 'use-existing') {
      const location = locationsById.get(mapping.targetLocationId);
      if (!location) {
        errors.push(
          `Location mapping "${mapping.sourceLocation}" references an unknown location`,
        );
      } else if (
        mapping.targetLocationName !== undefined &&
        mapping.targetLocationName !== location.name
      ) {
        errors.push(
          `Location mapping "${mapping.sourceLocation}" does not use the canonical location name`,
        );
      }
    }

    if (mapping.action === 'use-existing-area') {
      const location = locationsById.get(mapping.targetLocationId);
      const area = areasById.get(mapping.targetAreaId);
      if (!location) {
        errors.push(
          `Location mapping "${mapping.sourceLocation}" references an unknown location`,
        );
      }
      if (!area) {
        errors.push(
          `Location mapping "${mapping.sourceLocation}" references an unknown area`,
        );
      } else if (area.locationId !== mapping.targetLocationId) {
        errors.push(
          `Location mapping "${mapping.sourceLocation}" references an area outside its location`,
        );
      } else if (
        mapping.areaPath !== undefined &&
        mapping.areaPath !== area.path
      ) {
        errors.push(
          `Location mapping "${mapping.sourceLocation}" does not use the canonical area path`,
        );
      }
      if (
        location &&
        mapping.targetLocationName !== undefined &&
        mapping.targetLocationName !== location.name
      ) {
        errors.push(
          `Location mapping "${mapping.sourceLocation}" does not use the canonical location name`,
        );
      }
    }

    if (
      mapping.action === 'create-area' &&
      mapping.targetLocationId !== undefined &&
      !locationsById.has(mapping.targetLocationId)
    ) {
      errors.push(
        `Location mapping "${mapping.sourceLocation}" references an unknown location`,
      );
    }
  }
};

const sameRows = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length &&
  left.every((row, index) => row === right[index]);

const validateSkuConflictResolutions = (
  plan: ProductImportApprovedPlanV2Dto,
  baseline: ProductImportAiProposalV2Dto,
  errors: string[],
) => {
  validateExactCoverage(
    baseline.skuConflictResolutions.map((resolution) => resolution.conflictKey),
    plan.skuConflictResolutions.map((resolution) => resolution.conflictKey),
    'SKU conflict',
    errors,
  );
  validateNoDuplicates(
    plan.skuConflictResolutions.map((resolution) => resolution.mappingKey),
    'SKU conflict mapping key',
    errors,
  );
  const baselineByKey = new Map(
    baseline.skuConflictResolutions.map((resolution) =>
      mapEntry(resolution.conflictKey, resolution),
    ),
  );

  for (const resolution of plan.skuConflictResolutions) {
    const expected = baselineByKey.get(resolution.conflictKey);
    if (!expected) continue;
    const canonicalKey = skuConflictDecisionKey(expected.sourceSku);
    if (
      resolution.mappingKey !== canonicalKey ||
      resolution.mappingKey !== expected.mappingKey ||
      resolution.conflictKey !== canonicalKey
    ) {
      errors.push(
        `SKU conflict "${resolution.conflictKey}" has a non-canonical key`,
      );
    }
    if (resolution.sourceSku !== expected.sourceSku) {
      errors.push(
        `SKU conflict "${resolution.conflictKey}" has a non-canonical source SKU`,
      );
    }
    validateExactCoverage(
      expected.variants.map((variant) => variant.variantKey),
      resolution.variants.map((variant) => variant.variantKey),
      `variant for ${resolution.conflictKey}`,
      errors,
    );
    const expectedVariantsByKey = new Map(
      expected.variants.map((variant) => mapEntry(variant.variantKey, variant)),
    );
    for (const variant of resolution.variants) {
      const expectedVariant = expectedVariantsByKey.get(variant.variantKey);
      if (!expectedVariant) continue;
      if (!sameRows(variant.rows, expectedVariant.rows)) {
        errors.push(
          `SKU conflict variant "${variant.variantKey}" has non-canonical rows`,
        );
      }
      if (variant.action !== 'skip') {
        if (
          normalizeProductImportSku(variant.targetSku) !== variant.targetSku
        ) {
          errors.push(
            `SKU conflict variant "${variant.variantKey}" has an invalid target SKU`,
          );
        }
        if (
          variant.action === 'keep-source-sku' &&
          variant.targetSku !== expected.sourceSku
        ) {
          errors.push(
            `SKU conflict variant "${variant.variantKey}" must keep the canonical source SKU`,
          );
        }
      }
    }
  }
};

const validateMissingLocationStrategy = (
  plan: ProductImportApprovedPlanV2Dto,
  baseline: ProductImportAiProposalV2Dto,
  context: ProductImportTargetContextDto,
  errors: string[],
) => {
  const strategy = plan.missingLocationStrategy;
  if (strategy.mappingKey !== MISSING_LOCATION_DECISION_KEY) {
    errors.push('Missing-location strategy has a non-canonical mapping key');
  }
  if (strategy.rowCount !== baseline.missingLocationStrategy.rowCount) {
    errors.push('Missing-location strategy has a non-canonical row count');
  }
  validateCanonicalLocationName(
    strategy.targetLocationName,
    'Missing-location target',
    errors,
  );
  validateCanonicalPath(
    strategy.areaPath,
    'Missing-location area target',
    errors,
  );
  const locationsById = new Map(
    context.locations.map((location) => mapEntry(location.id, location)),
  );
  const areasById = new Map(
    context.areas.map((area) => mapEntry(area.id, area)),
  );

  if (strategy.action === 'use-existing-area') {
    const location = locationsById.get(strategy.targetLocationId);
    const area = areasById.get(strategy.targetAreaId);
    if (!location) {
      errors.push('Missing-location strategy references an unknown location');
    }
    if (!area) {
      errors.push('Missing-location strategy references an unknown area');
    } else if (area.locationId !== strategy.targetLocationId) {
      errors.push('Missing-location strategy area is outside its location');
    } else if (
      strategy.areaPath !== undefined &&
      strategy.areaPath !== area.path
    ) {
      errors.push(
        'Missing-location strategy does not use the canonical area path',
      );
    }
    if (
      location &&
      strategy.targetLocationName !== undefined &&
      strategy.targetLocationName !== location.name
    ) {
      errors.push(
        'Missing-location strategy does not use the canonical location name',
      );
    }
  } else if (
    strategy.action === 'assign-review-area' &&
    strategy.targetLocationId !== undefined &&
    !locationsById.has(strategy.targetLocationId)
  ) {
    errors.push('Missing-location strategy references an unknown location');
  }
};

const validateLockedKeys = (
  requested: readonly string[] | undefined,
  available: readonly string[],
  label: string,
  errors: string[],
) => {
  if (!requested) return;
  validateNoDuplicates(requested, `locked ${label} key`, errors);
  const availableKeys = new Set(available);
  for (const key of requested) {
    if (!availableKeys.has(key)) {
      errors.push(`Locked ${label} key "${key}" is not present in currentPlan`);
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

    if (locks && !plan) errors.push('Locked decisions require currentPlan');
    if (plan && plan.planVersion !== 2) {
      errors.push('Guided proposals require a complete version 2 currentPlan');
    }

    if (plan?.planVersion === 2) {
      if (locks?.photoPolicy && plan.photoPolicy === undefined) {
        errors.push('Locked photo policy is not present in currentPlan');
      }
      if (
        (plan.supplierMappings?.length ?? 0) > 0 ||
        plan.allowCreateSuppliers
      ) {
        errors.push('Guided proposals do not accept supplier decisions');
      }
      validateCategoryMappings(plan, baseline, context, errors);
      validateLocationMappings(plan, baseline, context, errors);
      validateSkuConflictResolutions(plan, baseline, errors);
      validateMissingLocationStrategy(plan, baseline, context, errors);
      validateNoDuplicates(
        [
          ...plan.categoryMappings.map((mapping) => mapping.mappingKey),
          ...plan.locationMappings.map((mapping) => mapping.mappingKey),
          ...plan.skuConflictResolutions.map(
            (resolution) => resolution.mappingKey,
          ),
          plan.missingLocationStrategy.mappingKey,
        ],
        'decision mapping key',
        errors,
      );
      validateLockedKeys(
        locks?.categoryMappings,
        plan.categoryMappings.map((mapping) => mapping.mappingKey),
        'category mapping',
        errors,
      );
      validateLockedKeys(
        locks?.locationMappings,
        plan.locationMappings.map((mapping) => mapping.mappingKey),
        'location mapping',
        errors,
      );
      validateLockedKeys(
        locks?.skuConflictResolutions,
        plan.skuConflictResolutions.map((resolution) => resolution.mappingKey),
        'SKU conflict',
        errors,
      );
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
