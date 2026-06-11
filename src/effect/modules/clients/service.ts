import { Effect } from 'effect';
import type { Schema } from 'effect';
import type {
  ClientResponseDto,
  ClientQueryDto,
  CreateClientSchema,
  UpdateClientSchema,
} from '@stocket/types/clients';
import { toPaginatedResponse, type PaginationMeta } from '@stocket/types/common';
import { fromNullOr, makeGetOrFail } from '../../platform/from-null-or';
import { toClientResponseDto } from './clients.utils';
import {
  ClientEmailAlreadyExists,
  ClientNotFound,
  type ClientsInfrastructureError,
} from './clients.errors';
import type { TenantNotResolved } from '../../platform/tenant-context';
import { ClientsRepository } from './repository';

type CreateClientDto = Schema.Schema.Type<typeof CreateClientSchema>;
type UpdateClientDto = Schema.Schema.Type<typeof UpdateClientSchema>;

export class ClientsService extends Effect.Service<ClientsService>()(
  '@stocket/effect/clients/ClientsService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* ClientsRepository;

      const getClientOrFail = makeGetOrFail(
        (id: string) => repository.findById(id),
        (id) => new ClientNotFound({ id, messageKey: 'clients.notFound' }),
      );

      const findAllPaginated = (
        query: ClientQueryDto,
      ): Effect.Effect<
        { data: ClientResponseDto[]; meta: PaginationMeta },
        ClientsInfrastructureError | TenantNotResolved
      > =>
        Effect.map(repository.findAllPaginated(query), (result) =>
          toPaginatedResponse(result, toClientResponseDto),
        ).pipe(Effect.withSpan('ClientsService.findAllPaginated'));

      const findOne = (
        id: string,
      ): Effect.Effect<
        ClientResponseDto,
        ClientNotFound | ClientsInfrastructureError | TenantNotResolved
      > =>
        Effect.map(getClientOrFail(id), toClientResponseDto).pipe(
          Effect.withSpan('ClientsService.findOne', { attributes: { id } }),
        );

      const create = (
        dto: CreateClientDto,
      ): Effect.Effect<
        ClientResponseDto,
        ClientEmailAlreadyExists | ClientsInfrastructureError | TenantNotResolved
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
        }).pipe(Effect.withSpan('ClientsService.create'));

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
          const client = yield* getClientOrFail(id);

          if (Object.keys(dto).length === 0) {
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
            repository.update(id, dto),
            () => new ClientNotFound({ id, messageKey: 'clients.notFound' }),
          );
          return toClientResponseDto(updated);
        }).pipe(Effect.withSpan('ClientsService.update', { attributes: { id } }));

      const remove = (
        id: string,
      ): Effect.Effect<
        void,
        ClientNotFound | ClientsInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          yield* getClientOrFail(id);
          yield* repository.delete(id);
        }).pipe(Effect.withSpan('ClientsService.delete', { attributes: { id } }));

      const existsById = (id: string) =>
        repository.existsById(id).pipe(
          Effect.withSpan('ClientsService.existsById', { attributes: { id } }),
        );

      return { findAllPaginated, findOne, create, update, delete: remove, existsById };
    }),
    dependencies: [ClientsRepository.Default],
  },
) {}
