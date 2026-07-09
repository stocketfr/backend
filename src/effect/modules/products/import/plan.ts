import type {
  NormalizedProductImportRow,
  ProductImportLocationMappingDto,
  ProductImportPlan,
} from './types';
import { normalizeStorageLocationName } from './storage-location/utils';
import { normalizeCategoryPath } from './utils/csv';

export const getSkuConflictPolicy = (
  approvedPlan: ProductImportPlan | undefined,
): 'reject' | 'derive-sku' | undefined => {
  if (!approvedPlan) {
    return undefined;
  }

  if (
    'skuConflictPolicy' in approvedPlan &&
    approvedPlan.skuConflictPolicy !== undefined
  ) {
    return approvedPlan.skuConflictPolicy;
  }

  if ('productIdentity' in approvedPlan) {
    return approvedPlan.productIdentity.conflictPolicy;
  }

  return undefined;
};

export const getDefaultLocationName = (
  approvedPlan: ProductImportPlan | undefined,
): string => {
  if (!approvedPlan) return '';
  if (
    !('defaultLocationName' in approvedPlan) ||
    approvedPlan.defaultLocationName === undefined
  ) {
    return '';
  }
  return approvedPlan.defaultLocationName.trim();
};

export const findLocationMapping = (
  row: NormalizedProductImportRow,
  approvedPlan: ProductImportPlan | undefined,
): ProductImportLocationMappingDto | undefined => {
  const sourceLocation = normalizeStorageLocationName(row.location);
  return approvedPlan?.locationMappings?.find(
    (mapping) =>
      normalizeStorageLocationName(mapping.sourceLocation) === sourceLocation,
  );
};

export const getTargetCategoryPath = (
  row: NormalizedProductImportRow,
  approvedPlan: ProductImportPlan | undefined,
): string => {
  const sourcePath = normalizeCategoryPath(row.category_path);
  const mapping = approvedPlan?.categoryMappings?.find(
    (candidate) => normalizeCategoryPath(candidate.sourcePath) === sourcePath,
  );
  return normalizeCategoryPath(mapping?.targetPath ?? sourcePath);
};
