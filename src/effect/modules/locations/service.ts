import { Effect } from 'effect';
import { toPaginatedResponse } from '@stocket/types/common';
import type {
  CreateLocationDto,
  UpdateLocationDto,
  LocationQueryDto,
  LocationResponseDto,
  PaginatedLocationsResponseDto,
} from '@stocket/types/locations';
import { fromNullOr, makeGetOrFail } from '../../platform/from-null-or';
import { toLocationResponseDto } from './locations.utils';
import {
  LocationNotFound,
  type LocationsInfrastructureError,
} from './locations.errors';
import type { TenantNotResolved } from '../../platform/tenant-context';
import { LocationsRepository } from './repository';

export class LocationsService extends Effect.Service<LocationsService>()(
  '@stocket/effect/locations/LocationsService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* LocationsRepository;

      const getLocationOrFail = makeGetOrFail(
        (id: string) => repository.findById(id),
        (id) => new LocationNotFound({ id, messageKey: 'locations.notFound' }),
      );

      const findAllPaginated = (
        query: LocationQueryDto,
      ): Effect.Effect<
        PaginatedLocationsResponseDto,
        LocationsInfrastructureError | TenantNotResolved
      > =>
        Effect.map(repository.findAllPaginated(query), (result) =>
          toPaginatedResponse(result, toLocationResponseDto),
        ).pipe(Effect.withSpan('LocationsService.findAllPaginated'));

      const findAll = (): Effect.Effect<
        LocationResponseDto[],
        LocationsInfrastructureError | TenantNotResolved
      > =>
        Effect.map(repository.findAll(), (locations) =>
          locations.map(toLocationResponseDto),
        ).pipe(Effect.withSpan('LocationsService.findAll'));

      const findOne = (
        id: string,
      ): Effect.Effect<
        LocationResponseDto,
        LocationNotFound | LocationsInfrastructureError | TenantNotResolved
      > =>
        Effect.map(getLocationOrFail(id), toLocationResponseDto).pipe(
          Effect.withSpan('LocationsService.findOne', { attributes: { id } }),
        );

      const create = (
        dto: CreateLocationDto,
      ): Effect.Effect<
        LocationResponseDto,
        LocationsInfrastructureError | TenantNotResolved
      > =>
        Effect.map(
          repository.create({
            name: dto.name,
            type: dto.type,
            address: dto.address ?? '',
            contact_person: dto.contact_person ?? '',
            phone: dto.phone ?? '',
            is_active: dto.is_active ?? true,
          }),
          toLocationResponseDto,
        ).pipe(Effect.withSpan('LocationsService.create'));

      const update = (
        id: string,
        dto: UpdateLocationDto,
      ): Effect.Effect<
        LocationResponseDto,
        LocationNotFound | LocationsInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          if (Object.keys(dto).length === 0) {
            const location = yield* getLocationOrFail(id);
            return toLocationResponseDto(location);
          }

          const updated = yield* fromNullOr(
            repository.update(id, dto),
            () => new LocationNotFound({ id, messageKey: 'locations.notFound' }),
          );
          return toLocationResponseDto(updated);
        }).pipe(Effect.withSpan('LocationsService.update', { attributes: { id } }));

      const remove = (
        id: string,
      ): Effect.Effect<
        void,
        LocationNotFound | LocationsInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          yield* getLocationOrFail(id);
          yield* repository.delete(id);
        }).pipe(Effect.withSpan('LocationsService.delete', { attributes: { id } }));

      const existsById = (id: string) =>
        repository.existsById(id).pipe(
          Effect.withSpan('LocationsService.existsById', { attributes: { id } }),
        );

      return {
        findAllPaginated,
        findAll,
        findOne,
        create,
        update,
        delete: remove,
        existsById,
      };
    }),
    dependencies: [LocationsRepository.Default],
  },
) {}
