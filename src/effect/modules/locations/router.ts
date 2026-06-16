import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  CreateLocationSchema,
  LocationIdSchema,
  LocationQuerySchema,
  UpdateLocationSchema,
} from '@stocket/types/locations';
import { requirePermission } from '../../platform/auth/authorization';
import { respondJson } from '../../platform/http/errors';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import { makeMessageResponse } from '../../platform/observability/messages';
import { LocationsService } from './service';

const LocationPathParams = Schema.Struct({ id: LocationIdSchema });

export const locationsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/all',
    Effect.gen(function* () {
      yield* requirePermission(Resource.LOCATIONS, Permission.READ);
      const locationsService = yield* LocationsService;
      return yield* respondJson(locationsService.findAll());
    }),
  ),
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.LOCATIONS, Permission.READ);
      const query = yield* HttpServerRequest.schemaSearchParams(LocationQuerySchema);
      const locationsService = yield* LocationsService;
      return yield* respondJson(locationsService.findAllPaginated(query));
    }),
  ),
  HttpRouter.get(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.LOCATIONS, Permission.READ);
      const { id } = yield* HttpRouter.schemaPathParams(LocationPathParams);
      const locationsService = yield* LocationsService;
      return yield* respondJson(locationsService.findOne(id));
    }),
  ),
  HttpRouter.post(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.LOCATIONS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(CreateLocationSchema);
      const locationsService = yield* LocationsService;
      return yield* respondAuditedMutation(locationsService.create(dto), {
        action: AuditAction.CREATE,
        entityType: AuditEntityType.LOCATION,
        entityId: (location) => location.id,
        responseOptions: { status: 201 },
      });
    }),
  ),
  HttpRouter.put(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.LOCATIONS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(LocationPathParams);
      const dto = yield* HttpServerRequest.schemaBodyJson(UpdateLocationSchema);
      const locationsService = yield* LocationsService;
      return yield* respondAuditedMutation(locationsService.update(id, dto), {
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.LOCATION,
        entityId: id,
      });
    }),
  ),
  HttpRouter.del(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.LOCATIONS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(LocationPathParams);
      const locationsService = yield* LocationsService;
      return yield* respondAuditedMutation(locationsService.delete(id), {
        action: AuditAction.DELETE,
        entityType: AuditEntityType.LOCATION,
        entityId: id,
        mapResponse: () => makeMessageResponse('locations.deleted'),
      });
    }),
  ),
  HttpRouter.prefixAll('/locations'),
);
