import { Effect } from 'effect';
import type { ProductImportApprovedPlanV2Dto } from '@stocket/types/products';
import { ProductImportProposalInvalid } from '../products.errors';
import { isProductImportPlanV2 } from './plan';
import { normalizeStorageLocationName } from './storage-location/utils';
import type {
  ImportAreaRow,
  ImportCategoryRow,
  NormalizedProductImportRow,
  ProductImportFormat,
  ProductImportPlan,
} from './types';
import type {
  ProductImportTargetError,
  ProductImportTargetRepository,
} from './targets/types';
import { normalizeCategoryPath } from './utils/csv';
import { findConflictingDuplicateSkuGroups } from './utils/duplicates';
import {
  categoryDecisionKey,
  locationDecisionKey,
  MISSING_LOCATION_DECISION_KEY,
  skuConflictDecisionKey,
} from './utils/proposal-keys';
import {
  normalizeProductImportLocationName,
  normalizeProductImportPath,
  normalizeProductImportSku,
} from './utils/proposal-values';

export interface ProductImportRowDecision {
  readonly action: 'import' | 'skip';
  readonly targetSku?: string;
}

export type ProductImportRowDecisions = ReadonlyMap<
  number,
  ProductImportRowDecision
>;

interface ValidateProductImportExecutionPlanOptions {
  readonly repository: ProductImportTargetRepository;
  readonly rows: readonly NormalizedProductImportRow[];
  readonly format: ProductImportFormat;
  readonly approvedPlan: ProductImportPlan | undefined;
}

const mapEntry = <K, V>(key: K, value: V): readonly [K, V] => [key, value];

const countBy = (
  rows: readonly NormalizedProductImportRow[],
  value: (row: NormalizedProductImportRow) => string,
) => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = value(row);
    if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const validateExactCountCoverage = (
  expected: ReadonlyMap<string, number>,
  actual: readonly { readonly source: string; readonly rowCount: number }[],
  label: string,
  errors: string[],
) => {
  const seen = new Set<string>();
  for (const item of actual) {
    if (seen.has(item.source)) {
      errors.push(`Duplicate ${label} source "${item.source}"`);
    }
    seen.add(item.source);
    const expectedCount = expected.get(item.source);
    if (expectedCount === undefined) {
      errors.push(`Unknown ${label} source "${item.source}"`);
    } else if (expectedCount !== item.rowCount) {
      errors.push(`${label} source "${item.source}" has an invalid row count`);
    }
  }
  for (const source of expected.keys()) {
    if (!seen.has(source)) errors.push(`Missing ${label} source "${source}"`);
  }
};

const validateDecisionKeys = (
  plan: ProductImportApprovedPlanV2Dto,
  errors: string[],
) => {
  const keys = [
    ...plan.categoryMappings.map((mapping) => mapping.mappingKey),
    ...plan.locationMappings.map((mapping) => mapping.mappingKey),
    ...plan.skuConflictResolutions.map((resolution) => resolution.mappingKey),
    plan.missingLocationStrategy.mappingKey,
  ];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) errors.push(`Duplicate decision mapping key "${key}"`);
    seen.add(key);
  }
};

const validateCanonicalTargets = (
  plan: ProductImportApprovedPlanV2Dto,
  errors: string[],
) => {
  for (const mapping of plan.categoryMappings) {
    if (mapping.mappingKey !== categoryDecisionKey(mapping.sourcePath)) {
      errors.push(
        `Category mapping "${mapping.sourcePath}" has an invalid key`,
      );
    }
    if (normalizeProductImportPath(mapping.targetPath) !== mapping.targetPath) {
      errors.push(`Category target "${mapping.targetPath}" is invalid`);
    }
  }
  for (const mapping of plan.locationMappings) {
    if (mapping.mappingKey !== locationDecisionKey(mapping.sourceLocation)) {
      errors.push(
        `Location mapping "${mapping.sourceLocation}" has an invalid key`,
      );
    }
    if (
      mapping.targetLocationName !== undefined &&
      normalizeProductImportLocationName(mapping.targetLocationName) !==
        mapping.targetLocationName
    ) {
      errors.push(`Location target "${mapping.targetLocationName}" is invalid`);
    }
    if (
      mapping.areaPath !== undefined &&
      normalizeProductImportPath(mapping.areaPath) !== mapping.areaPath
    ) {
      errors.push(`Area target "${mapping.areaPath}" is invalid`);
    }
  }
  const strategy = plan.missingLocationStrategy;
  if (strategy.mappingKey !== MISSING_LOCATION_DECISION_KEY) {
    errors.push('Missing-location strategy has an invalid key');
  }
  if (
    strategy.targetLocationName !== undefined &&
    normalizeProductImportLocationName(strategy.targetLocationName) !==
      strategy.targetLocationName
  ) {
    errors.push('Missing-location target name is invalid');
  }
  if (
    strategy.areaPath !== undefined &&
    normalizeProductImportPath(strategy.areaPath) !== strategy.areaPath
  ) {
    errors.push('Missing-location area path is invalid');
  }
};

const validateTenantTargets = (
  repository: ProductImportTargetRepository,
  plan: ProductImportApprovedPlanV2Dto,
  errors: string[],
) =>
  Effect.gen(function* () {
    // Categories have no active-state column; tenant ownership and canonical
    // ancestry are the enforceable stale-target checks for category IDs.
    for (const mapping of plan.categoryMappings) {
      if (mapping.action !== 'use-existing') continue;
      const names: string[] = [];
      const visited = new Set<string>();
      let categoryId: string | null = mapping.targetCategoryId;
      while (categoryId !== null && !visited.has(categoryId)) {
        visited.add(categoryId);
        const category: ImportCategoryRow | null =
          yield* repository.findCategoryById(categoryId);
        if (!category) {
          errors.push(
            `Category mapping "${mapping.sourcePath}" references an unknown category`,
          );
          break;
        }
        names.push(category.name);
        categoryId = category.parent_id;
      }
      if (categoryId !== null) {
        errors.push(
          `Category mapping "${mapping.sourcePath}" references invalid parentage`,
        );
      } else if (names.reverse().join(' / ') !== mapping.targetPath) {
        errors.push(
          `Category mapping "${mapping.sourcePath}" has a stale target path`,
        );
      }
    }

    const validateLocation = (
      locationId: string,
      expectedName: string | undefined,
      label: string,
    ) =>
      repository.findLocationById(locationId).pipe(
        Effect.map((location) => {
          if (!location) errors.push(`${label} references an unknown location`);
          else if (!location.is_active) {
            errors.push(`${label} references an inactive location`);
          } else if (
            expectedName !== undefined &&
            expectedName !== location.name
          ) {
            errors.push(`${label} has a stale target location name`);
          }
          return location;
        }),
      );
    const validateArea = (
      locationId: string,
      areaId: string,
      expectedPath: string | undefined,
      label: string,
    ) =>
      Effect.gen(function* () {
        const names: string[] = [];
        const visited = new Set<string>();
        let currentId: string | null = areaId;
        while (currentId !== null && !visited.has(currentId)) {
          visited.add(currentId);
          const current: ImportAreaRow | null =
            yield* repository.findAreaById(currentId);
          if (!current) {
            errors.push(`${label} references an unknown area`);
            return;
          }
          if (current.location_id !== locationId) {
            errors.push(`${label} references an area outside its location`);
            return;
          }
          if (currentId === areaId && !current.is_active) {
            errors.push(`${label} references an inactive area`);
            return;
          }
          names.push(current.name);
          currentId = current.parent_id;
        }
        if (currentId !== null) {
          errors.push(`${label} references invalid area parentage`);
          return;
        }
        if (
          expectedPath !== undefined &&
          names.reverse().join(' / ') !== expectedPath
        ) {
          errors.push(`${label} has a stale target area path`);
        }
      });

    for (const mapping of plan.locationMappings) {
      const label = `Location mapping "${mapping.sourceLocation}"`;
      if (mapping.targetLocationId !== undefined) {
        yield* validateLocation(
          mapping.targetLocationId,
          mapping.targetLocationName,
          label,
        );
      }
      if (mapping.action === 'use-existing-area') {
        yield* validateArea(
          mapping.targetLocationId,
          mapping.targetAreaId,
          mapping.areaPath,
          label,
        );
      }
    }

    const strategy = plan.missingLocationStrategy;
    if (strategy.targetLocationId !== undefined) {
      yield* validateLocation(
        strategy.targetLocationId,
        strategy.targetLocationName,
        'Missing-location strategy',
      );
    }
    if (strategy.action === 'use-existing-area') {
      yield* validateArea(
        strategy.targetLocationId,
        strategy.targetAreaId,
        strategy.areaPath,
        'Missing-location strategy',
      );
    }
  });

const makeV2RowDecisions = (
  rows: readonly NormalizedProductImportRow[],
  format: ProductImportFormat,
  plan: ProductImportApprovedPlanV2Dto,
  errors: string[],
): ProductImportRowDecisions => {
  const conflicts = findConflictingDuplicateSkuGroups(rows, {
    includeReorderPoint: format === 'normalized-products',
  });
  const expectedByConflict = new Map(
    conflicts.map((conflict) => mapEntry(conflict.conflictKey, conflict)),
  );
  const resolutionsByConflict = new Map(
    plan.skuConflictResolutions.map((resolution) =>
      mapEntry(resolution.conflictKey, resolution),
    ),
  );
  for (const key of resolutionsByConflict.keys()) {
    if (!expectedByConflict.has(key))
      errors.push(`Unknown SKU conflict "${key}"`);
  }

  const decisions = new Map<number, ProductImportRowDecision>();
  const reservedTargetSkus = new Map<string, string>();
  const conflictRows = new Set(
    conflicts.flatMap((conflict) => [...conflict.rows]),
  );

  for (const row of rows) {
    if (!row.sku || conflictRows.has(row.sourceRow)) continue;
    const normalized = normalizeProductImportSku(row.sku);
    if (normalized === undefined || normalized !== row.sku) {
      errors.push(`Source SKU on row ${row.sourceRow} is invalid`);
      continue;
    }
    reservedTargetSkus.set(normalized, `source SKU "${normalized}"`);
  }

  for (const conflict of conflicts) {
    const conflictKey =
      conflict.conflictKey ?? skuConflictDecisionKey(conflict.sku);
    const resolution = resolutionsByConflict.get(conflictKey);
    if (!resolution) {
      errors.push(`Missing SKU conflict "${conflictKey}"`);
      continue;
    }
    if (
      resolution.mappingKey !== conflictKey ||
      resolution.sourceSku !== conflict.sku
    ) {
      errors.push(`SKU conflict "${conflictKey}" has invalid identity`);
    }
    const expectedVariants = new Map(
      (conflict.variants ?? []).map((variant) =>
        mapEntry(variant.variantKey, variant),
      ),
    );
    const seenVariants = new Set<string>();
    for (const variant of resolution.variants) {
      if (seenVariants.has(variant.variantKey)) {
        errors.push(`Duplicate SKU variant "${variant.variantKey}"`);
        continue;
      }
      seenVariants.add(variant.variantKey);
      const expected = expectedVariants.get(variant.variantKey);
      if (!expected) {
        errors.push(`Unknown SKU variant "${variant.variantKey}"`);
        continue;
      }
      if (
        variant.rows.length !== expected.rows.length ||
        variant.rows.some((row, index) => row !== expected.rows[index])
      ) {
        errors.push(`SKU variant "${variant.variantKey}" has invalid rows`);
        continue;
      }
      if (variant.action === 'skip') {
        for (const row of variant.rows) decisions.set(row, { action: 'skip' });
        continue;
      }
      const targetSku = normalizeProductImportSku(variant.targetSku);
      if (targetSku === undefined || targetSku !== variant.targetSku) {
        errors.push(
          `SKU variant "${variant.variantKey}" has an invalid target SKU`,
        );
        continue;
      }
      if (variant.action === 'keep-source-sku' && targetSku !== conflict.sku) {
        errors.push(
          `SKU variant "${variant.variantKey}" must keep its source SKU`,
        );
      }
      const reservedBy = reservedTargetSkus.get(targetSku);
      if (reservedBy !== undefined) {
        errors.push(`Target SKU "${targetSku}" duplicates ${reservedBy}`);
      } else {
        reservedTargetSkus.set(targetSku, `variant "${variant.variantKey}"`);
      }
      for (const row of variant.rows) {
        decisions.set(row, { action: 'import', targetSku });
      }
    }
    for (const variantKey of expectedVariants.keys()) {
      if (!seenVariants.has(variantKey)) {
        errors.push(`Missing SKU variant "${variantKey}"`);
      }
    }
  }
  return decisions;
};

export const validateProductImportExecutionPlan = ({
  repository,
  rows,
  format,
  approvedPlan,
}: ValidateProductImportExecutionPlanOptions): Effect.Effect<
  ProductImportRowDecisions,
  ProductImportProposalInvalid | ProductImportTargetError
> =>
  Effect.gen(function* () {
    if (!isProductImportPlanV2(approvedPlan)) return new Map();

    const errors: string[] = [];
    validateExactCountCoverage(
      countBy(rows, (row) => normalizeCategoryPath(row.category_path)),
      approvedPlan.categoryMappings.map((mapping) => ({
        source: mapping.sourcePath,
        rowCount: mapping.rowCount,
      })),
      'category',
      errors,
    );
    validateExactCountCoverage(
      countBy(rows, (row) => normalizeStorageLocationName(row.location)),
      approvedPlan.locationMappings.map((mapping) => ({
        source: mapping.sourceLocation,
        rowCount: mapping.rowCount,
      })),
      'location',
      errors,
    );
    const missingLocations = rows.filter((row) => !row.location.trim()).length;
    if (approvedPlan.missingLocationStrategy.rowCount !== missingLocations) {
      errors.push('Missing-location strategy has an invalid row count');
    }
    validateDecisionKeys(approvedPlan, errors);
    validateCanonicalTargets(approvedPlan, errors);
    const decisions = makeV2RowDecisions(rows, format, approvedPlan, errors);
    yield* validateTenantTargets(repository, approvedPlan, errors);

    if (errors.length > 0) {
      return yield* Effect.fail(
        new ProductImportProposalInvalid({
          cause: errors.join('; '),
          messageKey: 'products.importProposalInvalid',
        }),
      );
    }
    return decisions;
  });
