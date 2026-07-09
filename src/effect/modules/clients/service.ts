import { Effect } from 'effect';
import type {
  ClientResponseDto,
  ClientQueryDto,
} from '@stocket/types/clients';
import {
  toPaginatedResponse,
  type PaginationMeta,
} from '@stocket/types/common';
import { makeReferenceEntityOperations } from '../../platform/reference-data-service';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { toClientResponseDto } from './mappers';
import {
  type ClientEmailAlreadyExists,
  ClientNotFound,
  type ClientsInfrastructureError,
} from './clients.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { ClientsRepository } from './repository';
import type { CreateClientDto, UpdateClientDto } from './types';
import { makeClientWriteWorkflows } from './write';

export class ClientsService extends Effect.Service<ClientsService>()(
  '@stocket/effect/clients/ClientsService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* ClientsRepository;
      const trace = makeServiceTracer({
        serviceName: 'ClientsService',
        module: 'clients',
        layer: 'service',
      });

      const referenceEntity = makeReferenceEntityOperations({
        findById: (id: string) => repository.findById(id),
        deleteById: (id: string) => repository.delete(id),
        existsById: (id: string) => repository.existsById(id),
        findByIds: (ids: readonly string[]) => repository.findByIds(ids),
        makeNotFound: (id) =>
          new ClientNotFound({ id, messageKey: 'clients.notFound' }),
        toResponse: toClientResponseDto,
      });

      const findAllPaginated = (
        query: ClientQueryDto,
      ): Effect.Effect<
        { data: ClientResponseDto[]; meta: PaginationMeta },
        ClientsInfrastructureError | TenantNotResolved
      > =>
        Effect.map(repository.findAllPaginated(query), (result) =>
          toPaginatedResponse(result, toClientResponseDto),
        ).pipe(trace.span('findAllPaginated'));

      const findOne = (
        id: string,
      ): Effect.Effect<
        ClientResponseDto,
        ClientNotFound | ClientsInfrastructureError | TenantNotResolved
      > =>
        referenceEntity
          .findOne(id)
          .pipe(trace.span('findOne', { attributes: { id } }));

      const clientWriteWorkflows = makeClientWriteWorkflows({
        repository,
        getClientOrFail: referenceEntity.getOrFail,
      });

      const create = (
        dto: CreateClientDto,
      ): Effect.Effect<
        ClientResponseDto,
        | ClientEmailAlreadyExists
        | ClientsInfrastructureError
        | TenantNotResolved
      > =>
        clientWriteWorkflows.create(dto).pipe(trace.span('create'));

      const update = (
        id: string,
        dto: UpdateClientDto,
      ): Effect.Effect<
        ClientResponseDto,
        | ClientEmailAlreadyExists
        | ClientNotFound
        | ClientsInfrastructureError
        | TenantNotResolved
      > =>
        clientWriteWorkflows
          .update(id, dto)
          .pipe(trace.span('update', { attributes: { id } }));

      const remove = (
        id: string,
      ): Effect.Effect<
        void,
        ClientNotFound | ClientsInfrastructureError | TenantNotResolved
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
        findOne,
        create,
        update,
        delete: remove,
        existsById,
        ensureExistsById,
        ensureExistByIds,
      };
    }),
    dependencies: [ClientsRepository.Default],
  },
) {}
