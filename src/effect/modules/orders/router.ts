import { HttpRouter } from '@effect/platform';
import { Effect, Schema } from 'effect';
import {
  CreateOrderSchema,
  OrderIdSchema,
  OrderQuerySchema,
  UpdateOrderSchema,
  UpdateOrderStatusSchema,
} from '@stocket/types/orders';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { FeatureKey } from '@stocket/types/features';
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
import { FeaturesService } from '../features/service';
import { OrdersService } from './service';

const OrderPathParams = Schema.Struct({ id: OrderIdSchema });
const requireOrdersFeature = Effect.flatMap(FeaturesService, (features) =>
  features.requireFeature(FeatureKey.ORDERS),
);

export const ordersRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    tenantRoute({
      permissions: [[Resource.ORDERS, Permission.READ]],
      guard: requireOrdersFeature,
      decode: queryParams(OrderQuerySchema),
      handler: ({ input: query }) =>
        Effect.flatMap(OrdersService, (ordersService) =>
          ordersService.findAllPaginated(query),
        ),
    }),
  ),
  HttpRouter.get(
    '/:id',
    tenantRoute({
      permissions: [[Resource.ORDERS, Permission.READ]],
      guard: requireOrdersFeature,
      decode: pathParams(OrderPathParams),
      handler: ({ input: { id } }) =>
        Effect.flatMap(OrdersService, (ordersService) =>
          ordersService.findOne(id),
        ),
    }),
  ),
  HttpRouter.post(
    '/',
    tenantRouteContext({
      permissions: [[Resource.ORDERS, Permission.WRITE]],
      guard: requireOrdersFeature,
      decode: jsonBody(CreateOrderSchema),
      session: 'optional',
    }).pipe(
      Effect.flatMap(({ input: dto, userId }) =>
        respondAuditedMutation(
          Effect.flatMap(OrdersService, (ordersService) =>
            ordersService.create(dto, userId ?? ''),
          ),
          {
            action: AuditAction.CREATE,
            entityType: AuditEntityType.ORDER,
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
      permissions: [[Resource.ORDERS, Permission.WRITE]],
      guard: requireOrdersFeature,
      decode: pathParamsAndJsonBody(OrderPathParams, UpdateOrderSchema),
    }).pipe(
      Effect.flatMap(({ input: { path, body } }) =>
        respondAuditedMutation(
          Effect.flatMap(OrdersService, (ordersService) =>
            ordersService.update(path.id, body),
          ),
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.ORDER,
            entityId: path.id,
          },
        ),
      ),
    ),
  ),
  HttpRouter.patch(
    '/:id/status',
    tenantRouteContext({
      permissions: [[Resource.ORDERS, Permission.WRITE]],
      guard: requireOrdersFeature,
      decode: pathParamsAndJsonBody(OrderPathParams, UpdateOrderStatusSchema),
    }).pipe(
      Effect.flatMap(({ input: { path, body } }) =>
        respondAuditedMutation(
          Effect.flatMap(OrdersService, (ordersService) =>
            ordersService.updateStatus(path.id, body),
          ),
          {
            action: AuditAction.STATUS_CHANGE,
            entityType: AuditEntityType.ORDER,
            entityId: path.id,
          },
        ),
      ),
    ),
  ),
  HttpRouter.del(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.ORDERS, Permission.WRITE]],
      guard: requireOrdersFeature,
      decode: pathParams(OrderPathParams),
    }).pipe(
      Effect.flatMap(({ input: { id } }) =>
        respondAuditedMutation(
          Effect.flatMap(OrdersService, (ordersService) =>
            ordersService.delete(id),
          ),
          {
            action: AuditAction.DELETE,
            entityType: AuditEntityType.ORDER,
            entityId: id,
            mapResponse: () => makeMessageResponse('orders.deleted'),
          },
        ),
      ),
    ),
  ),
  HttpRouter.prefixAll('/orders'),
);
