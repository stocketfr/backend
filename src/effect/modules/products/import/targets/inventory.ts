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
      return { locationId: null, areaId: null };
    }

    const mapping = findLocationMapping(row, approvedPlan);
    if (mapping?.action === 'ignore') {
      return { locationId: null, areaId: null };
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
