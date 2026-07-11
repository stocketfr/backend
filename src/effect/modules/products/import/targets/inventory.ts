import { Effect } from 'effect';
import { LocationType } from '@stocket/types/locations';
import type {
  ImportAreaRow,
  ImportCaches,
  ImportLocationRow,
  NormalizedProductImportRow,
  ProductImportPlan,
  ProductImportResultDto,
} from '../types';
import {
  findLocationMapping,
  getDefaultLocationName,
  isProductImportPlanV2,
} from '../plan';
import { normalizeStorageLocationName } from '../storage-location/utils';
import {
  type ImportInventoryTarget,
  type ProductImportTargetError,
  type ProductImportTargetRepository,
} from './types';
import { ProductsInfrastructureError } from '../../products.errors';

interface ResolveInventoryTargetOptions {
  readonly repository: ProductImportTargetRepository;
  readonly row: NormalizedProductImportRow;
  readonly caches: ImportCaches;
  readonly result: ProductImportResultDto;
  readonly approvedPlan: ProductImportPlan | undefined;
}

const getOrCreateLocation = (
  repository: ProductImportTargetRepository,
  locationName: string,
  caches: ImportCaches,
  result: ProductImportResultDto,
): Effect.Effect<string | null, ProductImportTargetError> =>
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
  repository: ProductImportTargetRepository,
  locationId: string,
  caches: ImportCaches,
): Effect.Effect<string, ProductImportTargetError> =>
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

const findAreaId = (
  repository: ProductImportTargetRepository,
  locationId: string,
  areaId: string,
  caches: ImportCaches,
): Effect.Effect<string, ProductImportTargetError> =>
  Effect.gen(function* () {
    const cacheKey = `${locationId}:id:${areaId}`;
    const cached = caches.areas.get(cacheKey);
    if (cached) return cached;

    const area = yield* repository.findAreaById(areaId);
    if (!area || area.location_id !== locationId) {
      return yield* Effect.fail(
        new ProductsInfrastructureError({
          action: 'resolve import area by id',
          messageKey: 'products.repositoryFailed',
        }),
      );
    }

    caches.areas.set(cacheKey, area.id);
    return area.id;
  });

const getOrCreateAreaPath = (
  repository: ProductImportTargetRepository,
  locationId: string,
  areaPath: string,
  caches: ImportCaches,
  result: ProductImportResultDto,
): Effect.Effect<string | null, ProductImportTargetError> =>
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

export const resolveInventoryTarget = ({
  repository,
  row,
  caches,
  result,
  approvedPlan,
}: ResolveInventoryTargetOptions): Effect.Effect<
  ImportInventoryTarget,
  ProductImportTargetError
> =>
  Effect.gen(function* () {
    const rawLocation = row.location.trim();
    if (rawLocation === '') {
      if (!isProductImportPlanV2(approvedPlan)) {
        return { locationId: null, areaId: null };
      }

      const strategy = approvedPlan.missingLocationStrategy;
      if (strategy.action === 'skip-inventory') {
        return { locationId: null, areaId: null };
      }
      const locationId =
        strategy.targetLocationId !== undefined
          ? yield* findLocationId(repository, strategy.targetLocationId, caches)
          : yield* getOrCreateLocation(
              repository,
              strategy.targetLocationName,
              caches,
              result,
            );
      if (!locationId) {
        return yield* Effect.fail(
          new ProductsInfrastructureError({
            action: 'resolve missing import location',
            messageKey: 'products.importAreaLocationRequired',
          }),
        );
      }
      if (strategy.action === 'use-existing-area') {
        const areaId = yield* findAreaId(
          repository,
          locationId,
          strategy.targetAreaId,
          caches,
        );
        return { locationId, areaId };
      }
      const areaId = yield* getOrCreateAreaPath(
        repository,
        locationId,
        strategy.areaPath,
        caches,
        result,
      );
      return { locationId, areaId };
    }

    const mapping = findLocationMapping(row, approvedPlan);
    if (mapping?.action === 'ignore') {
      return { locationId: null, areaId: null };
    }

    if (mapping?.action === 'use-existing-area') {
      const locationId = yield* findLocationId(
        repository,
        mapping.targetLocationId,
        caches,
      );
      const areaId = yield* findAreaId(
        repository,
        locationId,
        mapping.targetAreaId,
        caches,
      );
      return { locationId, areaId };
    }

    if (mapping?.action === 'create-area' && mapping.areaPath) {
      const targetLocationName =
        mapping.targetLocationName?.trim() ||
        getDefaultLocationName(approvedPlan);
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
