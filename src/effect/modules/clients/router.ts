import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  ClientIdSchema,
  ClientQuerySchema,
  CreateClientSchema,
  UpdateClientSchema,
} from '@stocket/types/clients';
import { requirePermission } from '../../platform/authorization';
import { respondJson } from '../../platform/errors';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import { makeMessageResponse } from '../../platform/messages';
import { ClientsService } from './service';

const ClientPathParams = Schema.Struct({ id: ClientIdSchema });

export const clientsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.CLIENTS, Permission.READ);
      const query = yield* HttpServerRequest.schemaSearchParams(ClientQuerySchema);
      const clientsService = yield* ClientsService;
      return yield* respondJson(clientsService.findAllPaginated(query));
    }),
  ),
  HttpRouter.get(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.CLIENTS, Permission.READ);
      const { id } = yield* HttpRouter.schemaPathParams(ClientPathParams);
      const clientsService = yield* ClientsService;
      return yield* respondJson(clientsService.findOne(id));
    }),
  ),
  HttpRouter.post(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.CLIENTS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(CreateClientSchema);
      const clientsService = yield* ClientsService;
      return yield* respondAuditedMutation(clientsService.create(dto), {
        action: AuditAction.CREATE,
        entityType: AuditEntityType.CLIENT,
        entityId: (client) => client.id,
        responseOptions: { status: 201 },
      });
    }),
  ),
  HttpRouter.put(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.CLIENTS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(ClientPathParams);
      const dto = yield* HttpServerRequest.schemaBodyJson(UpdateClientSchema);
      const clientsService = yield* ClientsService;
      return yield* respondAuditedMutation(clientsService.update(id, dto), {
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.CLIENT,
        entityId: id,
      });
    }),
  ),
  HttpRouter.del(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.CLIENTS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(ClientPathParams);
      const clientsService = yield* ClientsService;
      return yield* respondAuditedMutation(clientsService.delete(id), {
        action: AuditAction.DELETE,
        entityType: AuditEntityType.CLIENT,
        entityId: id,
        mapResponse: () => makeMessageResponse('clients.deleted'),
      });
    }),
  ),
  HttpRouter.prefixAll('/clients'),
);
