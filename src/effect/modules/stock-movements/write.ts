import { Effect } from 'effect';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { makeEnsureExistsById } from '../../platform/effect/existence';
import {
  InvalidDestinationLocation,
  InvalidSourceLocation,
  InvalidStockMovementOrder,
  InvalidStockMovementProduct,
  StockMovementNotFound,
  type StockMovementsInfrastructureError,
} from './stock-movements.errors';
import { toStockMovementCreateValues } from './stock-movements.utils';
import { toStockMovementResponseDto } from './mappers';
import type {
  CreateStockMovementDto,
  StockMovementCreateValues,
  StockMovementRow,
  StockMovementWithRelations,
} from './types';

export interface StockMovementWriteRepository {
  readonly create: (
    values: StockMovementCreateValues,
  ) => Effect.Effect<
    StockMovementRow,
    StockMovementsInfrastructureError | TenantNotResolved
  >;
  readonly findById: (
    id: string,
  ) => Effect.Effect<
    StockMovementWithRelations | null,
    StockMovementsInfrastructureError | TenantNotResolved
  >;
  readonly orderExistsById: (
    orderId: string,
  ) => Effect.Effect<
    boolean,
    StockMovementsInfrastructureError | TenantNotResolved
  >;
}

interface StockMovementWriteWorkflowOptions<
  ProductError,
  ProductContext,
  LocationError,
  LocationContext,
> {
  readonly repository: StockMovementWriteRepository;
  readonly productExists: (
    productId: string,
  ) => Effect.Effect<boolean, ProductError, ProductContext>;
  readonly locationExists: (
    locationId: string,
  ) => Effect.Effect<boolean, LocationError, LocationContext>;
}

const makeStockMovementNotFound = (id: string) =>
  new StockMovementNotFound({
    id,
    messageKey: 'stockMovements.notFound',
  });

const getCreatedMovementOrFail = (
  repository: StockMovementWriteRepository,
  id: string,
) =>
  repository
    .findById(id)
    .pipe(
      Effect.flatMap((stockMovement) =>
        stockMovement
          ? Effect.succeed(stockMovement)
          : Effect.fail(makeStockMovementNotFound(id)),
      ),
    );

export const makeStockMovementWriteWorkflows = <
  ProductError,
  ProductContext,
  LocationError,
  LocationContext,
>({
  repository,
  productExists,
  locationExists,
}: StockMovementWriteWorkflowOptions<
  ProductError,
  ProductContext,
  LocationError,
  LocationContext
>) => {
  const ensureProductExists = makeEnsureExistsById(
    productExists,
    (productId) =>
      new InvalidStockMovementProduct({
        productId,
        messageKey: 'stockMovements.productNotFound',
      }),
  );

  const ensureSourceLocationExists = makeEnsureExistsById(
    locationExists,
    (locationId) =>
      new InvalidSourceLocation({
        locationId,
        messageKey: 'stockMovements.sourceLocationNotFound',
      }),
  );

  const ensureDestinationLocationExists = makeEnsureExistsById(
    locationExists,
    (locationId) =>
      new InvalidDestinationLocation({
        locationId,
        messageKey: 'stockMovements.destinationLocationNotFound',
      }),
  );

  const ensureOrderExists = makeEnsureExistsById(
    repository.orderExistsById,
    (orderId) =>
      new InvalidStockMovementOrder({
        orderId,
        messageKey: 'stockMovements.orderNotFound',
      }),
  );

  const create = (dto: CreateStockMovementDto, userId: string) =>
    Effect.gen(function* () {
      yield* ensureProductExists(dto.product_id);

      const sourceLocationId = dto.from_location_id;
      if (sourceLocationId) {
        yield* ensureSourceLocationExists(sourceLocationId);
      }

      const destinationLocationId = dto.to_location_id;
      if (destinationLocationId) {
        yield* ensureDestinationLocationExists(destinationLocationId);
      }

      const orderId = dto.order_id;
      if (orderId) {
        yield* ensureOrderExists(orderId);
      }

      const stockMovement = yield* repository.create(
        toStockMovementCreateValues(dto, userId),
      );
      const stockMovementWithRelations = yield* getCreatedMovementOrFail(
        repository,
        stockMovement.id,
      );

      return toStockMovementResponseDto(stockMovementWithRelations);
    });

  return { create };
};
