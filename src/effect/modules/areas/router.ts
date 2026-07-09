import { HttpRouter } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  AreaIdSchema,
  AreaQuerySchema,
  CreateAreaSchema,
  UpdateAreaSchema,
} from '@stocket/types/areas';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import {
  jsonBody,
  pathParams,
  pathParamsAndJsonBody,
  queryParams,
  tenantRouteContext,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { makeMessageResponse } from '../../platform/observability/messages';
import { AreasService } from './service';

const AreaPathParams = Schema.Struct({ id: AreaIdSchema });

export const areasRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/',
    tenantRouteContext({
      permissions: [[Resource.LOCATIONS, Permission.WRITE]],
      decode: jsonBody(CreateAreaSchema),
    }).pipe(
      Effect.flatMap(({ input: dto }) =>
        respondAuditedMutation(
          Effect.flatMap(AreasService, (areasService) =>
            areasService.create(dto),
          ),
          {
            action: AuditAction.CREATE,
            entityType: AuditEntityType.AREA,
            entityId: (area) => area.id,
            responseOptions: { status: 201 },
          },
        ),
      ),
    ),
  ),
  HttpRouter.get(
    '/',
    tenantRoute({
      permissions: [[Resource.LOCATIONS, Permission.READ]],
      decode: queryParams(AreaQuerySchema),
      handler: ({ input: query }) =>
        Effect.flatMap(AreasService, (areasService) =>
          areasService.findAll(query),
        ),
    }),
  ),
  HttpRouter.get(
    '/:id/children',
    tenantRoute({
      permissions: [[Resource.LOCATIONS, Permission.READ]],
      decode: pathParams(AreaPathParams),
      handler: ({ input: { id } }) =>
        Effect.flatMap(AreasService, (areasService) =>
          areasService.findByIdWithChildren(id),
        ),
    }),
  ),
  HttpRouter.get(
    '/:id',
    tenantRoute({
      permissions: [[Resource.LOCATIONS, Permission.READ]],
      decode: pathParams(AreaPathParams),
      handler: ({ input: { id } }) =>
        Effect.flatMap(AreasService, (areasService) =>
          areasService.findById(id),
        ),
    }),
  ),
  HttpRouter.put(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.LOCATIONS, Permission.WRITE]],
      decode: pathParamsAndJsonBody(AreaPathParams, UpdateAreaSchema),
    }).pipe(
      Effect.flatMap(({ input: { path, body } }) =>
        respondAuditedMutation(
          Effect.flatMap(AreasService, (areasService) =>
            areasService.update(path.id, body),
          ),
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.AREA,
            entityId: path.id,
          },
        ),
      ),
    ),
  ),
  HttpRouter.del(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.LOCATIONS, Permission.WRITE]],
      decode: pathParams(AreaPathParams),
    }).pipe(
      Effect.flatMap(({ input: { id } }) =>
        respondAuditedMutation(
          Effect.flatMap(AreasService, (areasService) =>
            areasService.delete(id),
          ),
          {
            action: AuditAction.DELETE,
            entityType: AuditEntityType.AREA,
            entityId: id,
            mapResponse: () => makeMessageResponse('areas.deleted'),
          },
        ),
      ),
    ),
  ),
  HttpRouter.prefixAll('/areas'),
);
