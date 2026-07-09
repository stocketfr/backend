import { HttpRouter } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { Permission, Resource } from '@stocket/types/auth';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import {
  CreateStockMovementSchema,
  StockMovementIdSchema,
  StockMovementQuerySchema,
} from '@stocket/types/stock-movements';
import {
  jsonBody,
  pathParams,
  queryParams,
  tenantRouteContext,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { StockMovementsService } from './service';

const StockMovementPathParams = Schema.Struct({ id: StockMovementIdSchema });
const ProductPathParams = Schema.Struct({ productId: Schema.UUID });
const LocationPathParams = Schema.Struct({ locationId: Schema.UUID });

export const stockMovementsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    tenantRoute({
      permissions: [[Resource.STOCK_MOVEMENTS, Permission.READ]],
      decode: queryParams(StockMovementQuerySchema),
      handler: ({ input: query }) =>
        Effect.flatMap(StockMovementsService, (stockMovementsService) =>
          stockMovementsService.findAllPaginated(query),
        ),
    }),
  ),
  HttpRouter.get(
    '/product/:productId',
    tenantRoute({
      permissions: [[Resource.STOCK_MOVEMENTS, Permission.READ]],
      decode: pathParams(ProductPathParams),
      handler: ({ input: { productId } }) =>
        Effect.flatMap(StockMovementsService, (stockMovementsService) =>
          stockMovementsService.findByProduct(productId),
        ),
    }),
  ),
  HttpRouter.get(
    '/location/:locationId',
    tenantRoute({
      permissions: [[Resource.STOCK_MOVEMENTS, Permission.READ]],
      decode: pathParams(LocationPathParams),
      handler: ({ input: { locationId } }) =>
        Effect.flatMap(StockMovementsService, (stockMovementsService) =>
          stockMovementsService.findByLocation(locationId),
        ),
    }),
  ),
  HttpRouter.get(
    '/:id',
    tenantRoute({
      permissions: [[Resource.STOCK_MOVEMENTS, Permission.READ]],
      decode: pathParams(StockMovementPathParams),
      handler: ({ input: { id } }) =>
        Effect.flatMap(StockMovementsService, (stockMovementsService) =>
          stockMovementsService.findOne(id),
        ),
    }),
  ),
  HttpRouter.post(
    '/',
    tenantRouteContext({
      permissions: [[Resource.STOCK_MOVEMENTS, Permission.WRITE]],
      decode: jsonBody(CreateStockMovementSchema),
      session: 'required',
    }).pipe(
      Effect.flatMap(({ input: dto, session }) =>
        respondAuditedMutation(
          Effect.flatMap(StockMovementsService, (stockMovementsService) =>
            session
              ? stockMovementsService.create(dto, session.user.id)
              : Effect.dieMessage(
                  'Required session missing for stock movement creation',
                ),
          ),
          {
            action: AuditAction.CREATE,
            entityType: AuditEntityType.STOCK_MOVEMENT,
            entityId: (result) => result.id,
            responseOptions: { status: 201 },
          },
        ),
      ),
    ),
  ),
  HttpRouter.prefixAll('/stock-movements'),
);
