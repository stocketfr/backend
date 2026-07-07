import { Effect } from 'effect';
import { LocationType } from '@stocket/types/locations';
import { ProductsInfrastructureError } from '../products.errors';
import type { ProductImportRepository } from './repository';
import type {
  ImportCaches,
  ImportAreaRow,
  ImportCategoryRow,
  ImportInventoryTarget,
  ImportLocationRow,
  NormalizedProductImportRow,
  ProductImportApprovedPlanDto,
  ProductImportLocationMappingDto,
  ProductImportResultDto,
} from './types';
import { normalizeCategoryPath, normalizeStorageLocationName } from './utils';

const emptyInventoryTarget = (): ImportInventoryTarget => ({
  locationId: null,
  areaId: null,
});

export const getOrCreateCategoryPath = (
  repository: ProductImportRepository,
  categoryPath: string,
  caches: ImportCaches,
  result: ProductImportResultDto,
) =>
  Effect.gen(function* () {
    const parts = normalizeCategoryPath(categoryPath)
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length === 0) {
      return yield* Effect.fail(
        new ProductsInfrastructureError({
          action: 'resolve import category path',
          messageKey: 'products.repositoryFailed',
        }),
      );
    }

    let parentId: string | null = null;
    let categoryId = '';

    for (const part of parts) {
      const cacheKey = `${parentId ?? 'root'}:${part}`;
      const cached = caches.categories.get(cacheKey);
      if (cached) {
        parentId = cached;
        categoryId = cached;
        continue;
      }

      let category: ImportCategoryRow | null =
        yield* repository.findCategoryByNameAndParent(part, parentId);

      if (!category) {
        category = yield* repository.createCategory({
          name: part,
          parent_id: parentId,
          description: 'Imported via product import',
        });
        result.categoriesCreated++;
      }

      caches.categories.set(cacheKey, category.id);
      parentId = category.id;
      categoryId = category.id;
    }

    return categoryId;
  });

const getOrCreateLocation = (
  repository: ProductImportRepository,
  locationName: string,
  caches: ImportCaches,
  result: ProductImportResultDto,
) =>
  Effect.gen(function* () {
    const name = locationName.trim();
    if (name === '') return null;

    const cached = caches.locations.get(name);
    if (cached) return cached;

    let location: ImportLocationRow | null =
      yield* repository.findLocationByName(name);

    if (!location) {
      location = yield* repository.createLocation({
        name,
        type: LocationType.WAREHOUSE,
        address: '',
        contact_person: '',
        phone: '',
        is_active: true,
      });
      result.locationsCreated++;
    }

    caches.locations.set(name, location.id);
    return location.id;
  });

const findLocationId = (
  repository: ProductImportRepository,
  locationId: string,
  caches: ImportCaches,
) =>
  Effect.gen(function* () {
    const cached = caches.locations.get(locationId);
    if (cached) return cached;

    const location = yield* repository.findLocationById(locationId);
    if (!location) {
      return yield* Effect.fail(
        new ProductsInfrastructureError({
          action: 'resolve import location by id',
          messageKey: 'products.repositoryFailed',
        }),
      );
    }

    caches.locations.set(location.id, location.id);
    caches.locations.set(location.name, location.id);
    return location.id;
  });

const getOrCreateAreaPath = (
  repository: ProductImportRepository,
  locationId: string,
  areaPath: string,
  caches: ImportCaches,
  result: ProductImportResultDto,
) =>
  Effect.gen(function* () {
    const parts = areaPath
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;

    let parentId: string | null = null;
    let areaId = '';

    for (const part of parts) {
      const cacheKey = `${locationId}:${parentId ?? 'root'}:${part}`;
      const cached = caches.areas.get(cacheKey);
      if (cached) {
        parentId = cached;
        areaId = cached;
        continue;
      }

      let area: ImportAreaRow | null =
        yield* repository.findAreaByNameLocationAndParent(
          locationId,
          part,
          parentId,
        );

      if (!area) {
        area = yield* repository.createArea({
          location_id: locationId,
          parent_id: parentId,
          name: part,
          description: 'Imported via product import',
          code: '',
          is_active: true,
        });
        result.areasCreated = (result.areasCreated ?? 0) + 1;
      }

      caches.areas.set(cacheKey, area.id);
      parentId = area.id;
      areaId = area.id;
    }

    return areaId;
  });

const findLocationMapping = (
  row: NormalizedProductImportRow,
  approvedPlan: ProductImportApprovedPlanDto | undefined,
): ProductImportLocationMappingDto | undefined => {
  const sourceLocation = normalizeStorageLocationName(row.location);
  return approvedPlan?.locationMappings?.find(
    (mapping) =>
      normalizeStorageLocationName(mapping.sourceLocation) === sourceLocation,
  );
};

export const getTargetCategoryPath = (
  row: NormalizedProductImportRow,
  approvedPlan: ProductImportApprovedPlanDto | undefined,
): string => {
  const sourcePath = normalizeCategoryPath(row.category_path);
  const mapping = approvedPlan?.categoryMappings?.find(
    (candidate) => normalizeCategoryPath(candidate.sourcePath) === sourcePath,
  );
  return normalizeCategoryPath(mapping?.targetPath ?? sourcePath);
};

export const resolveInventoryTarget = (
  repository: ProductImportRepository,
  row: NormalizedProductImportRow,
  caches: ImportCaches,
  result: ProductImportResultDto,
  approvedPlan: ProductImportApprovedPlanDto | undefined,
) =>
  Effect.gen(function* () {
    const rawLocation = row.location.trim();
    if (rawLocation === '') return emptyInventoryTarget();

    const mapping = findLocationMapping(row, approvedPlan);
    if (mapping?.action === 'ignore') return emptyInventoryTarget();

    if (mapping?.action === 'create-area' && mapping.areaPath) {
      const targetLocationName =
        mapping.targetLocationName?.trim() ||
        approvedPlan?.defaultLocationName?.trim() ||
        '';
      const locationId = mapping.targetLocationId
        ? yield* findLocationId(repository, mapping.targetLocationId, caches)
        : yield* getOrCreateLocation(
            repository,
            targetLocationName,
            caches,
            result,
          );

      if (!locationId) {
        return yield* Effect.fail(
          new ProductsInfrastructureError({
            action: 'resolve import area location',
            messageKey: 'products.importAreaLocationRequired',
          }),
        );
      }

      const areaId = yield* getOrCreateAreaPath(
        repository,
        locationId,
        mapping.areaPath,
        caches,
        result,
      );
      return { locationId, areaId };
    }

    if (mapping?.targetLocationId) {
      const locationId = yield* findLocationId(
        repository,
        mapping.targetLocationId,
        caches,
      );
      return { locationId, areaId: null };
    }

    const locationName =
      mapping?.targetLocationName?.trim() ||
      (mapping ? normalizeStorageLocationName(row.location) : row.location);
    const locationId = yield* getOrCreateLocation(
      repository,
      locationName,
      caches,
      result,
    );
    return { locationId, areaId: null };
  });
