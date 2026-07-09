import { Effect } from 'effect';
import { toPaginatedResponse } from '@stocket/types/common';
import type {
  CreateLocationDto,
  UpdateLocationDto,
  LocationQueryDto,
  LocationResponseDto,
  PaginatedLocationsResponseDto,
} from '@stocket/types/locations';
import { makeReferenceEntityOperations } from '../../platform/reference-data-service';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { toLocationResponseDto } from './mappers';
import {
  LocationNotFound,
  type LocationsInfrastructureError,
} from './locations.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { LocationsRepository } from './repository';
import { makeLocationWriteWorkflows } from './write';

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
        referenceEntity
          .findOne(id)
          .pipe(trace.span('findOne', { attributes: { id } }));

      const locationWriteWorkflows = makeLocationWriteWorkflows({
        repository,
        getLocationOrFail: referenceEntity.getOrFail,
      });

      const create = (
        dto: CreateLocationDto,
      ): Effect.Effect<
        LocationResponseDto,
        LocationsInfrastructureError | TenantNotResolved
      > => locationWriteWorkflows.create(dto).pipe(trace.span('create'));

      const update = (
        id: string,
        dto: UpdateLocationDto,
      ): Effect.Effect<
        LocationResponseDto,
        LocationNotFound | LocationsInfrastructureError | TenantNotResolved
      > =>
        locationWriteWorkflows
          .update(id, dto)
          .pipe(trace.span('update', { attributes: { id } }));

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
        referenceEntity
          .existsById(id)
          .pipe(trace.span('existsById', { attributes: { id } }));

      const ensureExistsById = (id: string) =>
        referenceEntity
          .ensureExistsById(id)
          .pipe(trace.span('ensureExistsById', { attributes: { id } }));

      const ensureExistByIds = (ids: readonly string[]) =>
        referenceEntity
          .ensureExistByIds(ids)
          .pipe(trace.span('ensureExistByIds'));

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
