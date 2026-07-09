import { Effect } from 'effect';
import type { Schema } from 'effect';
import type {
  ClientResponseDto,
  ClientQueryDto,
  CreateClientSchema,
  UpdateClientSchema,
} from '@stocket/types/clients';
import {
  toPaginatedResponse,
  type PaginationMeta,
} from '@stocket/types/common';
import { fromNullOr } from '../../platform/effect/from-null-or';
import {
  hasDefinedPatchValues,
  pickDefined,
} from '../../platform/effect/pick-defined';
import { makeReferenceEntityOperations } from '../../platform/reference-data-service';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { toClientResponseDto } from './clients.utils';
import {
  ClientEmailAlreadyExists,
  ClientNotFound,
  type ClientsInfrastructureError,
} from './clients.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { ClientsRepository } from './repository';

type CreateClientDto = Schema.Schema.Type<typeof CreateClientSchema>;
type UpdateClientDto = Schema.Schema.Type<typeof UpdateClientSchema>;

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

      const create = (
        dto: CreateClientDto,
      ): Effect.Effect<
        ClientResponseDto,
        | ClientEmailAlreadyExists
        | ClientsInfrastructureError
        | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const existing = yield* repository.findByEmail(dto.email);
          if (existing) {
            return yield* Effect.fail(
              new ClientEmailAlreadyExists({
                email: dto.email,
                messageKey: 'clients.emailAlreadyExists',
              }),
            );
          }

          const client = yield* repository.create({
            company_name: dto.company_name,
            contact_person: dto.contact_person,
            email: dto.email,
            yacht_name: dto.yacht_name ?? null,
            phone: dto.phone ?? null,
            billing_address: dto.billing_address ?? null,
            default_delivery_address: dto.default_delivery_address ?? null,
            account_status: dto.account_status,
            payment_terms: dto.payment_terms ?? null,
            credit_limit: dto.credit_limit ?? null,
            notes: dto.notes ?? null,
          });

          return toClientResponseDto(client);
        }).pipe(trace.span('create'));

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
        Effect.gen(function* () {
          const client = yield* referenceEntity.getOrFail(id);
          const updateData = pickDefined<UpdateClientDto>([
            ['company_name', dto.company_name],
            ['contact_person', dto.contact_person],
            ['email', dto.email],
            ['yacht_name', dto.yacht_name],
            ['phone', dto.phone],
            ['billing_address', dto.billing_address],
            ['default_delivery_address', dto.default_delivery_address],
            ['account_status', dto.account_status],
            ['payment_terms', dto.payment_terms],
            ['credit_limit', dto.credit_limit],
            ['notes', dto.notes],
          ]);

          if (!hasDefinedPatchValues(updateData)) {
            return toClientResponseDto(client);
          }

          if (dto.email && dto.email !== client.email) {
            const existing = yield* repository.findByEmail(dto.email);
            if (existing) {
              return yield* Effect.fail(
                new ClientEmailAlreadyExists({
                  email: dto.email,
                  messageKey: 'clients.emailAlreadyExists',
                }),
              );
            }
          }

          const updated = yield* fromNullOr(
            repository.update(id, updateData),
            () => new ClientNotFound({ id, messageKey: 'clients.notFound' }),
          );
          return toClientResponseDto(updated);
        }).pipe(trace.span('update', { attributes: { id } }));

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
