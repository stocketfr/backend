import { HttpRouter } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import {
  ClientIdSchema,
  ClientQuerySchema,
  CreateClientSchema,
  UpdateClientSchema,
} from '@stocket/types/clients';
import { makeMessageResponse } from '../../platform/observability/messages';
import {
  jsonBody,
  pathParams,
  pathParamsAndJsonBody,
  queryParams,
  tenantRouteContext,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { ClientsService } from './service';

const ClientPathParams = Schema.Struct({ id: ClientIdSchema });

export const clientsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    tenantRoute({
      permissions: [[Resource.CLIENTS, Permission.READ]],
      decode: queryParams(ClientQuerySchema),
      handler: ({ input: query }) =>
        Effect.flatMap(ClientsService, (clientsService) =>
          clientsService.findAllPaginated(query),
        ),
    }),
  ),
  HttpRouter.get(
    '/:id',
    tenantRoute({
      permissions: [[Resource.CLIENTS, Permission.READ]],
      decode: pathParams(ClientPathParams),
      handler: ({ input: { id } }) =>
        Effect.flatMap(ClientsService, (clientsService) =>
          clientsService.findOne(id),
        ),
    }),
  ),
  HttpRouter.post(
    '/',
    tenantRouteContext({
      permissions: [[Resource.CLIENTS, Permission.WRITE]],
      decode: jsonBody(CreateClientSchema),
    }).pipe(
      Effect.flatMap(({ input: dto }) =>
        respondAuditedMutation(
          Effect.flatMap(ClientsService, (clientsService) =>
            clientsService.create(dto),
          ),
          {
            action: AuditAction.CREATE,
            entityType: AuditEntityType.CLIENT,
            entityId: (client) => client.id,
            responseOptions: { status: 201 },
          },
        ),
      ),
    ),
  ),
  HttpRouter.put(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.CLIENTS, Permission.WRITE]],
      decode: pathParamsAndJsonBody(ClientPathParams, UpdateClientSchema),
    }).pipe(
      Effect.flatMap(({ input: { path, body } }) =>
        respondAuditedMutation(
          Effect.flatMap(ClientsService, (clientsService) =>
            clientsService.update(path.id, body),
          ),
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.CLIENT,
            entityId: ({ id }) => id,
          },
        ),
      ),
    ),
  ),
  HttpRouter.del(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.CLIENTS, Permission.WRITE]],
      decode: pathParams(ClientPathParams),
    }).pipe(
      Effect.flatMap(({ input: { id } }) =>
        respondAuditedMutation(
          Effect.flatMap(ClientsService, (clientsService) =>
            clientsService.delete(id),
          ),
          {
            action: AuditAction.DELETE,
            entityType: AuditEntityType.CLIENT,
            entityId: id,
            mapResponse: () => makeMessageResponse('clients.deleted'),
          },
        ),
      ),
    ),
  ),
  HttpRouter.prefixAll('/clients'),
);
