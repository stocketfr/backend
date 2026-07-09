import { Effect } from 'effect';
import { fromNullOr } from '../../platform/effect/from-null-or';
import { hasDefinedPatchValues } from '../../platform/effect/pick-defined';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import {
  toLocationCreateValues,
  toLocationUpdateValues,
} from './locations.utils';
import { toLocationResponseDto } from './mappers';
import {
  LocationNotFound,
  type LocationsInfrastructureError,
} from './locations.errors';
import type {
  LocationCreateValues,
  LocationEntity,
  LocationUpdateValues,
} from './types';
import type {
  CreateLocationDto,
  UpdateLocationDto,
} from '@stocket/types/locations';

export interface LocationWriteRepository {
  readonly create: (
    values: LocationCreateValues,
  ) => Effect.Effect<
    LocationEntity,
    LocationsInfrastructureError | TenantNotResolved
  >;
  readonly update: (
    id: string,
    values: LocationUpdateValues,
  ) => Effect.Effect<
    LocationEntity | null,
    LocationsInfrastructureError | TenantNotResolved
  >;
}

interface LocationWriteWorkflowOptions<GetError, GetContext> {
  readonly repository: LocationWriteRepository;
  readonly getLocationOrFail: (
    id: string,
  ) => Effect.Effect<LocationEntity, GetError, GetContext>;
}

const makeLocationNotFound = (id: string) =>
  new LocationNotFound({ id, messageKey: 'locations.notFound' });

export const makeLocationWriteWorkflows = <GetError, GetContext>({
  repository,
  getLocationOrFail,
}: LocationWriteWorkflowOptions<GetError, GetContext>) => {
  const create = (dto: CreateLocationDto) =>
    Effect.map(repository.create(toLocationCreateValues(dto)), (location) =>
      toLocationResponseDto(location),
    );

  const update = (id: string, dto: UpdateLocationDto) =>
    Effect.gen(function* () {
      const updateData = toLocationUpdateValues(dto);

      if (!hasDefinedPatchValues(updateData)) {
        const location = yield* getLocationOrFail(id);
        return toLocationResponseDto(location);
      }

      const updated = yield* fromNullOr(repository.update(id, updateData), () =>
        makeLocationNotFound(id),
      );

      return toLocationResponseDto(updated);
    });

  return {
    create,
    update,
  };
};
