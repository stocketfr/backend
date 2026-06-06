import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  AreaIdSchema,
  AreaQuerySchema,
  CreateAreaSchema,
  UpdateAreaSchema,
} from '@stocket/types/areas';
import { requirePermission } from '../../platform/authorization';
import { respondJson } from '../../platform/errors';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import { makeMessageResponse } from '../../platform/messages';
import { AreasService } from './service';

const AreaPathParams = Schema.Struct({ id: AreaIdSchema });

export const areasRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.LOCATIONS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(CreateAreaSchema);
      const areasService = yield* AreasService;
      return yield* respondAuditedMutation(areasService.create(dto), {
        action: AuditAction.CREATE,
        entityType: AuditEntityType.AREA,
        entityId: (area) => area.id,
        responseOptions: { status: 201 },
      });
    }),
  ),
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.LOCATIONS, Permission.READ);
      const query = yield* HttpServerRequest.schemaSearchParams(AreaQuerySchema);
      const areasService = yield* AreasService;
      return yield* respondJson(areasService.findAll(query));
    }),
  ),
  HttpRouter.get(
    '/:id/children',
    Effect.gen(function* () {
      yield* requirePermission(Resource.LOCATIONS, Permission.READ);
      const { id } = yield* HttpRouter.schemaPathParams(AreaPathParams);
      const areasService = yield* AreasService;
      return yield* respondJson(areasService.findByIdWithChildren(id));
    }),
  ),
  HttpRouter.get(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.LOCATIONS, Permission.READ);
      const { id } = yield* HttpRouter.schemaPathParams(AreaPathParams);
      const areasService = yield* AreasService;
      return yield* respondJson(areasService.findById(id));
    }),
  ),
  HttpRouter.put(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.LOCATIONS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(AreaPathParams);
      const dto = yield* HttpServerRequest.schemaBodyJson(UpdateAreaSchema);
      const areasService = yield* AreasService;
      return yield* respondAuditedMutation(areasService.update(id, dto), {
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.AREA,
        entityId: id,
      });
    }),
  ),
  HttpRouter.del(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.LOCATIONS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(AreaPathParams);
      const areasService = yield* AreasService;
      return yield* respondAuditedMutation(areasService.delete(id), {
        action: AuditAction.DELETE,
        entityType: AuditEntityType.AREA,
        entityId: id,
        mapResponse: () => makeMessageResponse('areas.deleted'),
      });
    }),
  ),
  HttpRouter.prefixAll('/areas'),
);
