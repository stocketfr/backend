import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { Permission, Resource } from '@stocket/types/auth';
import {
  AdjustInventorySchema,
  CreateInventorySchema,
  InventoryIdSchema,
  InventoryQuerySchema,
  UpdateInventorySchema,
} from '@stocket/types/inventory';
import { requirePermission } from '../../platform/auth/authorization';
import { AuditLogWriter } from '../../platform/audit/index';
import { respondJson, respondJsonOk } from '../../platform/http/errors';
import { makeMessageResponse } from '../../platform/observability/messages';
import { InventoryService } from './service';

const InventoryPathParams = Schema.Struct({ id: InventoryIdSchema });
const ProductPathParams = Schema.Struct({ productId: Schema.UUID });
const LocationPathParams = Schema.Struct({ locationId: Schema.UUID });

export const inventoryRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.INVENTORY, Permission.READ);
      const query =
        yield* HttpServerRequest.schemaSearchParams(InventoryQuerySchema);
      const inventoryService = yield* InventoryService;
      return yield* respondJson(inventoryService.findAllPaginated(query));
    }),
  ),
  HttpRouter.get(
    '/all',
    Effect.gen(function* () {
      yield* requirePermission(Resource.INVENTORY, Permission.READ);
      const inventoryService = yield* InventoryService;
      return yield* respondJson(inventoryService.findAll());
    }),
  ),
  HttpRouter.get(
    '/product/:productId',
    Effect.gen(function* () {
      yield* requirePermission(Resource.INVENTORY, Permission.READ);
      const { productId } =
        yield* HttpRouter.schemaPathParams(ProductPathParams);
      const inventoryService = yield* InventoryService;
      return yield* respondJson(inventoryService.findByProduct(productId));
    }),
  ),
  HttpRouter.get(
    '/location/:locationId',
    Effect.gen(function* () {
      yield* requirePermission(Resource.INVENTORY, Permission.READ);
      const { locationId } =
        yield* HttpRouter.schemaPathParams(LocationPathParams);
      const inventoryService = yield* InventoryService;
      return yield* respondJson(inventoryService.findByLocation(locationId));
    }),
  ),
  HttpRouter.get(
    '/summary',
    Effect.gen(function* () {
      yield* requirePermission(Resource.INVENTORY, Permission.READ);
      const inventoryService = yield* InventoryService;
      return yield* respondJson(inventoryService.findSummary());
    }),
  ),
  HttpRouter.get(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.INVENTORY, Permission.READ);
      const { id } = yield* HttpRouter.schemaPathParams(InventoryPathParams);
      const inventoryService = yield* InventoryService;
      return yield* respondJson(inventoryService.findOne(id));
    }),
  ),
  HttpRouter.post(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.INVENTORY, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(
        CreateInventorySchema,
      );
      const inventoryService = yield* InventoryService;
      const result = yield* inventoryService.create(dto);
      const auditLogWriter = yield* AuditLogWriter;
      yield* auditLogWriter.log({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.INVENTORY,
        entityId: result.id,
      });
      return yield* respondJsonOk(result, { status: 201 });
    }),
  ),
  HttpRouter.put(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.INVENTORY, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(InventoryPathParams);
      const dto = yield* HttpServerRequest.schemaBodyJson(
        UpdateInventorySchema,
      );
      const inventoryService = yield* InventoryService;
      const result = yield* inventoryService.update(id, dto);
      const auditLogWriter = yield* AuditLogWriter;
      yield* auditLogWriter.log({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.INVENTORY,
        entityId: id,
      });
      return yield* respondJsonOk(result);
    }),
  ),
  HttpRouter.patch(
    '/:id/adjust',
    Effect.gen(function* () {
      yield* requirePermission(Resource.INVENTORY, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(InventoryPathParams);
      const dto = yield* HttpServerRequest.schemaBodyJson(
        AdjustInventorySchema,
      );
      const inventoryService = yield* InventoryService;
      const result = yield* inventoryService.adjustQuantity(id, dto);
      const auditLogWriter = yield* AuditLogWriter;
      yield* auditLogWriter.log({
        action: AuditAction.ADJUST_QUANTITY,
        entityType: AuditEntityType.INVENTORY,
        entityId: id,
      });
      return yield* respondJsonOk(result);
    }),
  ),
  HttpRouter.del(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.INVENTORY, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(InventoryPathParams);
      const inventoryService = yield* InventoryService;
      yield* inventoryService.delete(id);
      const auditLogWriter = yield* AuditLogWriter;
      yield* auditLogWriter.log({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.INVENTORY,
        entityId: id,
      });
      return yield* respondJson(
        Effect.succeed(makeMessageResponse('inventory.deleted')),
      );
    }),
  ),
  HttpRouter.prefixAll('/inventory'),
);
