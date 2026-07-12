import type {
  ProductImportCategoryMappingDto,
  ProductImportCategoryMappingV2Dto,
  ProductImportLocationMappingV2Dto,
  ProductImportLocationMappingDto,
  ProductImportPhotoPolicyDto,
} from '@stocket/types/products';
import type { NormalizedProductImportRow, ProductImportPlan } from './types';
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

export const getPhotoPolicy = (
  approvedPlan: ProductImportPlan | undefined,
): ProductImportPhotoPolicyDto =>
  approvedPlan &&
  'photoPolicy' in approvedPlan &&
  approvedPlan.photoPolicy !== undefined
    ? approvedPlan.photoPolicy
    : 'import';

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
):
  | ProductImportLocationMappingDto
  | ProductImportLocationMappingV2Dto
  | undefined => {
  const sourceLocation = normalizeStorageLocationName(row.location);
  return approvedPlan?.locationMappings?.find(
    (mapping) =>
      normalizeStorageLocationName(mapping.sourceLocation) === sourceLocation,
  );
};

export const findCategoryMapping = (
  row: NormalizedProductImportRow,
  approvedPlan: ProductImportPlan | undefined,
):
  | ProductImportCategoryMappingDto
  | ProductImportCategoryMappingV2Dto
  | undefined => {
  const sourcePath = normalizeCategoryPath(row.category_path);
  return approvedPlan?.categoryMappings?.find(
    (candidate) => normalizeCategoryPath(candidate.sourcePath) === sourcePath,
  );
};

export const getTargetCategoryPath = (
  row: NormalizedProductImportRow,
  approvedPlan: ProductImportPlan | undefined,
): string => {
  const sourcePath = normalizeCategoryPath(row.category_path);
  const mapping = findCategoryMapping(row, approvedPlan);
  return normalizeCategoryPath(mapping?.targetPath ?? sourcePath);
};

export const isProductImportPlanV2 = (
  approvedPlan: ProductImportPlan | undefined,
): approvedPlan is Extract<ProductImportPlan, { readonly planVersion: 2 }> =>
  approvedPlan?.planVersion === 2;
