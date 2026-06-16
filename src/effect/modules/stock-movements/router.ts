import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { Permission, Resource } from '@stocket/types/auth';
import {
  CreateStockMovementSchema,
  StockMovementIdSchema,
  StockMovementQuerySchema,
} from '@stocket/types/stock-movements';
import { requirePermission } from '../../platform/auth/authorization';
import { AuditLogWriter } from '../../platform/audit/index';
import { respondJson, respondJsonOk } from '../../platform/http/errors';
import { requireSession } from '../../platform/http/session';
import { StockMovementsService } from './service';

const StockMovementPathParams = Schema.Struct({ id: StockMovementIdSchema });
const ProductPathParams = Schema.Struct({ productId: Schema.UUID });
const LocationPathParams = Schema.Struct({ locationId: Schema.UUID });

export const stockMovementsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.STOCK_MOVEMENTS, Permission.READ);
      const query = yield* HttpServerRequest.schemaSearchParams(
        StockMovementQuerySchema,
      );
      const stockMovementsService = yield* StockMovementsService;
      return yield* respondJson(stockMovementsService.findAllPaginated(query));
    }),
  ),
  HttpRouter.get(
    '/product/:productId',
    Effect.gen(function* () {
      yield* requirePermission(Resource.STOCK_MOVEMENTS, Permission.READ);
      const { productId } =
        yield* HttpRouter.schemaPathParams(ProductPathParams);
      const stockMovementsService = yield* StockMovementsService;
      return yield* respondJson(stockMovementsService.findByProduct(productId));
    }),
  ),
  HttpRouter.get(
    '/location/:locationId',
    Effect.gen(function* () {
      yield* requirePermission(Resource.STOCK_MOVEMENTS, Permission.READ);
      const { locationId } =
        yield* HttpRouter.schemaPathParams(LocationPathParams);
      const stockMovementsService = yield* StockMovementsService;
      return yield* respondJson(
        stockMovementsService.findByLocation(locationId),
      );
    }),
  ),
  HttpRouter.get(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.STOCK_MOVEMENTS, Permission.READ);
      const { id } = yield* HttpRouter.schemaPathParams(
        StockMovementPathParams,
      );
      const stockMovementsService = yield* StockMovementsService;
      return yield* respondJson(stockMovementsService.findOne(id));
    }),
  ),
  HttpRouter.post(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.STOCK_MOVEMENTS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(
        CreateStockMovementSchema,
      );
      const session = yield* requireSession;
      const stockMovementsService = yield* StockMovementsService;
      const result = yield* stockMovementsService.create(dto, session.user.id);
      const auditLogWriter = yield* AuditLogWriter;
      yield* auditLogWriter.log({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.STOCK_MOVEMENT,
        entityId: result.id,
      });
      return yield* respondJsonOk(result, { status: 201 });
    }),
  ),
  HttpRouter.prefixAll('/stock-movements'),
);
