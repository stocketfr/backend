import { Effect } from 'effect';
import { fromNullOr } from '../../platform/effect/from-null-or';
import { hasDefinedPatchValues } from '../../platform/effect/pick-defined';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { toClientCreateValues, toClientUpdateValues } from './clients.utils';
import { toClientResponseDto } from './mappers';
import {
  ClientEmailAlreadyExists,
  ClientNotFound,
  type ClientsInfrastructureError,
} from './clients.errors';
import type {
  ClientCreateValues,
  ClientEntity,
  ClientUpdateValues,
  CreateClientDto,
  UpdateClientDto,
} from './types';

export interface ClientWriteRepository {
  readonly findByEmail: (
    email: string,
  ) => Effect.Effect<
    ClientEntity | null,
    ClientsInfrastructureError | TenantNotResolved
  >;
  readonly create: (
    values: ClientCreateValues,
  ) => Effect.Effect<
    ClientEntity,
    ClientsInfrastructureError | TenantNotResolved
  >;
  readonly update: (
    id: string,
    values: ClientUpdateValues,
  ) => Effect.Effect<
    ClientEntity | null,
    ClientsInfrastructureError | TenantNotResolved
  >;
}

interface ClientWriteWorkflowOptions<GetError, GetContext> {
  readonly repository: ClientWriteRepository;
  readonly getClientOrFail: (
    id: string,
  ) => Effect.Effect<ClientEntity, GetError, GetContext>;
}

const makeClientNotFound = (id: string) =>
  new ClientNotFound({ id, messageKey: 'clients.notFound' });

const failIfEmailTaken = (repository: ClientWriteRepository, email: string) =>
  Effect.gen(function* () {
    const existing = yield* repository.findByEmail(email);
    if (existing) {
      return yield* Effect.fail(
        new ClientEmailAlreadyExists({
          email,
          messageKey: 'clients.emailAlreadyExists',
        }),
      );
    }
  });

export const makeClientWriteWorkflows = <GetError, GetContext>({
  repository,
  getClientOrFail,
}: ClientWriteWorkflowOptions<GetError, GetContext>) => {
  const create = (dto: CreateClientDto) =>
    Effect.gen(function* () {
      yield* failIfEmailTaken(repository, dto.email);

      const client = yield* repository.create(toClientCreateValues(dto));

      return toClientResponseDto(client);
    });

  const update = (id: string, dto: UpdateClientDto) =>
    Effect.gen(function* () {
      const client = yield* getClientOrFail(id);
      const updateData = toClientUpdateValues(dto);

      if (!hasDefinedPatchValues(updateData)) {
        return toClientResponseDto(client);
      }

      if (dto.email && dto.email !== client.email) {
        yield* failIfEmailTaken(repository, dto.email);
      }

      const updated = yield* fromNullOr(repository.update(id, updateData), () =>
        makeClientNotFound(id),
      );

      return toClientResponseDto(updated);
    });

  return {
    create,
    update,
  };
};
