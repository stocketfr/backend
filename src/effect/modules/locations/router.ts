import { HttpRouter } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  CreateLocationSchema,
  LocationIdSchema,
  LocationQuerySchema,
  UpdateLocationSchema,
} from '@stocket/types/locations';
import { makeMessageResponse } from '../../platform/observability/messages';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import {
  emptyInput,
  jsonBody,
  pathParams,
  pathParamsAndJsonBody,
  queryParams,
  tenantRouteContext,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { LocationsService } from './service';

const LocationPathParams = Schema.Struct({ id: LocationIdSchema });

export const locationsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/all',
    tenantRoute({
      permissions: [[Resource.LOCATIONS, Permission.READ]],
      decode: emptyInput,
      handler: () =>
        Effect.flatMap(LocationsService, (locationsService) =>
          locationsService.findAll(),
        ),
    }),
  ),
  HttpRouter.get(
    '/',
    tenantRoute({
      permissions: [[Resource.LOCATIONS, Permission.READ]],
      decode: queryParams(LocationQuerySchema),
      handler: ({ input: query }) =>
        Effect.flatMap(LocationsService, (locationsService) =>
          locationsService.findAllPaginated(query),
        ),
    }),
  ),
  HttpRouter.get(
    '/:id',
    tenantRoute({
      permissions: [[Resource.LOCATIONS, Permission.READ]],
      decode: pathParams(LocationPathParams),
      handler: ({ input: { id } }) =>
        Effect.flatMap(LocationsService, (locationsService) =>
          locationsService.findOne(id),
        ),
    }),
  ),
  HttpRouter.post(
    '/',
    tenantRouteContext({
      permissions: [[Resource.LOCATIONS, Permission.WRITE]],
      decode: jsonBody(CreateLocationSchema),
    }).pipe(
      Effect.flatMap(({ input: dto }) =>
        respondAuditedMutation(
          Effect.flatMap(LocationsService, (locationsService) =>
            locationsService.create(dto),
          ),
          {
            action: AuditAction.CREATE,
            entityType: AuditEntityType.LOCATION,
            entityId: (location) => location.id,
            responseOptions: { status: 201 },
          },
        ),
      ),
    ),
  ),
  HttpRouter.put(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.LOCATIONS, Permission.WRITE]],
      decode: pathParamsAndJsonBody(LocationPathParams, UpdateLocationSchema),
    }).pipe(
      Effect.flatMap(({ input: { path, body } }) =>
        respondAuditedMutation(
          Effect.flatMap(LocationsService, (locationsService) =>
            locationsService.update(path.id, body),
          ),
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.LOCATION,
            entityId: ({ id }) => id,
          },
        ),
      ),
    ),
  ),
  HttpRouter.del(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.LOCATIONS, Permission.WRITE]],
      decode: pathParams(LocationPathParams),
    }).pipe(
      Effect.flatMap(({ input: { id } }) =>
        respondAuditedMutation(
          Effect.flatMap(LocationsService, (locationsService) =>
            locationsService.delete(id),
          ),
          {
            action: AuditAction.DELETE,
            entityType: AuditEntityType.LOCATION,
            entityId: id,
            mapResponse: () => makeMessageResponse('locations.deleted'),
          },
        ),
      ),
    ),
  ),
  HttpRouter.prefixAll('/locations'),
);
