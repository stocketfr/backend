import { Effect } from 'effect';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
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
  ) => Effect.Effect<boolean, StockMovementsInfrastructureError | TenantNotResolved>;
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

const ensureExisting = <ExistsError, Context, MissingError>(
  exists: Effect.Effect<boolean, ExistsError, Context>,
  makeError: () => MissingError,
) => exists.pipe(Effect.filterOrFail(Boolean, makeError), Effect.asVoid);

const makeStockMovementNotFound = (id: string) =>
  new StockMovementNotFound({
    id,
    messageKey: 'stockMovements.notFound',
  });

const getCreatedMovementOrFail = (
  repository: StockMovementWriteRepository,
  id: string,
) =>
  repository.findById(id).pipe(
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
  const create = (dto: CreateStockMovementDto, userId: string) =>
    Effect.gen(function* () {
      yield* ensureExisting(productExists(dto.product_id), () =>
        new InvalidStockMovementProduct({
          productId: dto.product_id,
          messageKey: 'stockMovements.productNotFound',
        }),
      );

      const sourceLocationId = dto.from_location_id;
      if (sourceLocationId) {
        yield* ensureExisting(locationExists(sourceLocationId), () =>
          new InvalidSourceLocation({
            locationId: sourceLocationId,
            messageKey: 'stockMovements.sourceLocationNotFound',
          }),
        );
      }

      const destinationLocationId = dto.to_location_id;
      if (destinationLocationId) {
        yield* ensureExisting(locationExists(destinationLocationId), () =>
          new InvalidDestinationLocation({
            locationId: destinationLocationId,
            messageKey: 'stockMovements.destinationLocationNotFound',
          }),
        );
      }

      const orderId = dto.order_id;
      if (orderId) {
        yield* ensureExisting(repository.orderExistsById(orderId), () =>
          new InvalidStockMovementOrder({
            orderId,
            messageKey: 'stockMovements.orderNotFound',
          }),
        );
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
