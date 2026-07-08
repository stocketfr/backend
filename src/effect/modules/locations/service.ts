import { Effect } from 'effect';
import { toPaginatedResponse } from '@stocket/types/common';
import type {
  CreateLocationDto,
  UpdateLocationDto,
  LocationQueryDto,
  LocationResponseDto,
  PaginatedLocationsResponseDto,
} from '@stocket/types/locations';
import { fromNullOr } from '../../platform/effect/from-null-or';
import {
  hasDefinedPatchValues,
  pickDefined,
} from '../../platform/effect/pick-defined';
import { makeReferenceEntityOperations } from '../../platform/reference-data-service';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { toLocationResponseDto } from './locations.utils';
import {
  LocationNotFound,
  type LocationsInfrastructureError,
} from './locations.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { LocationsRepository } from './repository';

export class LocationsService extends Effect.Service<LocationsService>()(
  '@stocket/effect/locations/LocationsService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* LocationsRepository;
      const trace = makeServiceTracer({
        serviceName: 'LocationsService',
        module: 'locations',
        layer: 'service',
      });

      const referenceEntity = makeReferenceEntityOperations({
        findById: (id: string) => repository.findById(id),
        deleteById: (id: string) => repository.delete(id),
        existsById: (id: string) => repository.existsById(id),
        findByIds: (ids: readonly string[]) => repository.findByIds(ids),
        makeNotFound: (id) =>
          new LocationNotFound({ id, messageKey: 'locations.notFound' }),
        toResponse: toLocationResponseDto,
      });

      const findAllPaginated = (
        query: LocationQueryDto,
      ): Effect.Effect<
        PaginatedLocationsResponseDto,
        LocationsInfrastructureError | TenantNotResolved
      > =>
        Effect.map(repository.findAllPaginated(query), (result) =>
          toPaginatedResponse(result, toLocationResponseDto),
        ).pipe(trace.span('findAllPaginated'));

      const findAll = (): Effect.Effect<
        LocationResponseDto[],
        LocationsInfrastructureError | TenantNotResolved
      > =>
        Effect.map(repository.findAll(), (locations) =>
          locations.map(toLocationResponseDto),
        ).pipe(trace.span('findAll'));

      const findOne = (
        id: string,
      ): Effect.Effect<
        LocationResponseDto,
        LocationNotFound | LocationsInfrastructureError | TenantNotResolved
      > =>
        referenceEntity.findOne(id).pipe(
          trace.span('findOne', { attributes: { id } }),
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
        ).pipe(trace.span('create'));

      const update = (
        id: string,
        dto: UpdateLocationDto,
      ): Effect.Effect<
        LocationResponseDto,
        LocationNotFound | LocationsInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const updateData = pickDefined<UpdateLocationDto>([
            ['name', dto.name],
            ['type', dto.type],
            ['address', dto.address],
            ['contact_person', dto.contact_person],
            ['phone', dto.phone],
            ['is_active', dto.is_active],
          ]);

          if (!hasDefinedPatchValues(updateData)) {
            const location = yield* referenceEntity.getOrFail(id);
            return toLocationResponseDto(location);
          }

          const updated = yield* fromNullOr(
            repository.update(id, updateData),
            () => new LocationNotFound({ id, messageKey: 'locations.notFound' }),
          );
          return toLocationResponseDto(updated);
        }).pipe(trace.span('update', { attributes: { id } }));

      const remove = (
        id: string,
      ): Effect.Effect<
        void,
        LocationNotFound | LocationsInfrastructureError | TenantNotResolved
      > =>
        referenceEntity
          .remove(id)
          .pipe(trace.span('delete', { attributes: { id } }));

      const existsById = (id: string) =>
        referenceEntity.existsById(id).pipe(
          trace.span('existsById', { attributes: { id } }),
        );

      const ensureExistsById = (id: string) =>
        referenceEntity.ensureExistsById(id).pipe(
          trace.span('ensureExistsById', { attributes: { id } }),
        );

      const ensureExistByIds = (ids: readonly string[]) =>
        referenceEntity.ensureExistByIds(ids).pipe(
          trace.span('ensureExistByIds'),
        );

      return {
        findAllPaginated,
        findAll,
        findOne,
        create,
        update,
        delete: remove,
        existsById,
        ensureExistsById,
        ensureExistByIds,
      };
    }),
    dependencies: [LocationsRepository.Default],
  },
) {}
