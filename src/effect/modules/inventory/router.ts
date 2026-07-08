import { HttpRouter } from '@effect/platform';
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
import { makeMessageResponse } from '../../platform/observability/messages';
import { InventoryService } from './service';

const InventoryPathParams = Schema.Struct({ id: InventoryIdSchema });
const ProductPathParams = Schema.Struct({ productId: Schema.UUID });
const LocationPathParams = Schema.Struct({ locationId: Schema.UUID });

export const inventoryRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    tenantRoute({
      permissions: [[Resource.INVENTORY, Permission.READ]],
      decode: queryParams(InventoryQuerySchema),
      handler: ({ input: query }) =>
        Effect.flatMap(InventoryService, (inventoryService) =>
          inventoryService.findAllPaginated(query),
        ),
    }),
  ),
  HttpRouter.get(
    '/all',
    tenantRoute({
      permissions: [[Resource.INVENTORY, Permission.READ]],
      decode: emptyInput,
      handler: () =>
        Effect.flatMap(InventoryService, (inventoryService) =>
          inventoryService.findAll(),
        ),
    }),
  ),
  HttpRouter.get(
    '/product/:productId',
    tenantRoute({
      permissions: [[Resource.INVENTORY, Permission.READ]],
      decode: pathParams(ProductPathParams),
      handler: ({ input: { productId } }) =>
        Effect.flatMap(InventoryService, (inventoryService) =>
          inventoryService.findByProduct(productId),
        ),
    }),
  ),
  HttpRouter.get(
    '/location/:locationId',
    tenantRoute({
      permissions: [[Resource.INVENTORY, Permission.READ]],
      decode: pathParams(LocationPathParams),
      handler: ({ input: { locationId } }) =>
        Effect.flatMap(InventoryService, (inventoryService) =>
          inventoryService.findByLocation(locationId),
        ),
    }),
  ),
  HttpRouter.get(
    '/summary',
    tenantRoute({
      permissions: [[Resource.INVENTORY, Permission.READ]],
      decode: emptyInput,
      handler: () =>
        Effect.flatMap(InventoryService, (inventoryService) =>
          inventoryService.findSummary(),
        ),
    }),
  ),
  HttpRouter.get(
    '/:id',
    tenantRoute({
      permissions: [[Resource.INVENTORY, Permission.READ]],
      decode: pathParams(InventoryPathParams),
      handler: ({ input: { id } }) =>
        Effect.flatMap(InventoryService, (inventoryService) =>
          inventoryService.findOne(id),
        ),
    }),
  ),
  HttpRouter.post(
    '/',
    tenantRouteContext({
      permissions: [[Resource.INVENTORY, Permission.WRITE]],
      decode: jsonBody(CreateInventorySchema),
    }).pipe(
      Effect.flatMap(({ input: dto }) =>
        respondAuditedMutation(
          Effect.flatMap(InventoryService, (inventoryService) =>
            inventoryService.create(dto),
          ),
          {
            action: AuditAction.CREATE,
            entityType: AuditEntityType.INVENTORY,
            entityId: (result) => result.id,
            responseOptions: { status: 201 },
          },
        ),
      ),
    ),
  ),
  HttpRouter.put(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.INVENTORY, Permission.WRITE]],
      decode: pathParamsAndJsonBody(InventoryPathParams, UpdateInventorySchema),
    }).pipe(
      Effect.flatMap(({ input: { path, body } }) =>
        respondAuditedMutation(
          Effect.flatMap(InventoryService, (inventoryService) =>
            inventoryService.update(path.id, body),
          ),
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.INVENTORY,
            entityId: path.id,
          },
        ),
      ),
    ),
  ),
  HttpRouter.patch(
    '/:id/adjust',
    tenantRouteContext({
      permissions: [[Resource.INVENTORY, Permission.WRITE]],
      decode: pathParamsAndJsonBody(InventoryPathParams, AdjustInventorySchema),
    }).pipe(
      Effect.flatMap(({ input: { path, body } }) =>
        respondAuditedMutation(
          Effect.flatMap(InventoryService, (inventoryService) =>
            inventoryService.adjustQuantity(path.id, body),
          ),
          {
            action: AuditAction.ADJUST_QUANTITY,
            entityType: AuditEntityType.INVENTORY,
            entityId: path.id,
          },
        ),
      ),
    ),
  ),
  HttpRouter.del(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.INVENTORY, Permission.WRITE]],
      decode: pathParams(InventoryPathParams),
    }).pipe(
      Effect.flatMap(({ input: { id } }) =>
        respondAuditedMutation(
          Effect.flatMap(InventoryService, (inventoryService) =>
            inventoryService.delete(id),
          ),
          {
            action: AuditAction.DELETE,
            entityType: AuditEntityType.INVENTORY,
            entityId: id,
            mapResponse: () => makeMessageResponse('inventory.deleted'),
          },
        ),
      ),
    ),
  ),
  HttpRouter.prefixAll('/inventory'),
);
