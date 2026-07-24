import { Effect } from 'effect';
import type {
  OrderFulfillmentView,
  PickInput,
} from '@stocket/types/fulfillment';
import { OrderStatus } from '@stocket/types/orders';
import { StockMovementReason } from '@stocket/types/stock-movements';
import { fromNullOr } from '../../platform/effect/from-null-or';
import { OrderStatusTransitionConflict } from '../orders/orders.errors';
import type { Order } from '../orders/types';
import { toFulfillmentView } from './mappers';
import {
  FulfillmentInfrastructureError,
  FulfillmentInvalidTransition,
  FulfillmentOrderNotFound,
  FulfillmentPickFailed,
  type FulfillmentError,
} from './errors';

export const PICKABLE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PICKING,
];

interface FulfillmentOrderItem {
  readonly id: string;
  readonly order_id: string;
  readonly product_id: string;
}

interface FulfillmentInventoryItem {
  readonly location_id: string | null;
}

interface FulfillmentStockMovementCreate {
  readonly product_id: string;
  readonly from_location_id: string | null;
  readonly quantity: number;
  readonly reason: StockMovementReason;
  readonly order_id: string;
  readonly user_id: string;
}

export interface FulfillmentPickRepositories {
  readonly ordersRepository: {
    readonly findByIdWithRelations: (
      orderId: string,
    ) => Effect.Effect<Order | null, unknown>;
    readonly transitionStatus: (
      orderId: string,
      expectedStatus: OrderStatus,
      data: { readonly status: OrderStatus },
    ) => Effect.Effect<boolean, unknown>;
  };
  readonly orderItemsRepository: {
    readonly findByIds: (
      ids: string[],
    ) => Effect.Effect<readonly FulfillmentOrderItem[] | null, unknown>;
    readonly incrementPicked: (
      orderItemId: string,
      quantity: number,
    ) => Effect.Effect<number, unknown>;
  };
  readonly inventoryRepository: {
    readonly adjustQuantity: (
      inventoryId: string,
      adjustment: number,
    ) => Effect.Effect<number, unknown>;
    readonly findByIdWithRelations: (
      inventoryId: string,
    ) => Effect.Effect<FulfillmentInventoryItem | null, unknown>;
  };
  readonly stockMovementsRepository: {
    readonly create: (
      data: FulfillmentStockMovementCreate,
    ) => Effect.Effect<unknown, unknown>;
  };
}

interface FulfillmentOrderLookupRepository {
  readonly findByIdWithRelations: (
    orderId: string,
  ) => Effect.Effect<Order | null, unknown>;
}

export interface FulfillmentPickInput {
  readonly orderId: string;
  readonly actorId: string;
  readonly picks: readonly PickInput[];
}

export const wrapFulfillmentInfrastructureError =
  (action: string) =>
  (cause: unknown): FulfillmentInfrastructureError =>
    new FulfillmentInfrastructureError({
      action,
      cause,
      messageKey: 'fulfillment.infrastructureFailed',
    });

export const loadFulfillmentOrderOrFail = (
  repository: FulfillmentOrderLookupRepository,
  orderId: string,
) =>
  fromNullOr(
    Effect.mapError(
      repository.findByIdWithRelations(orderId),
      wrapFulfillmentInfrastructureError('load order'),
    ),
    () =>
      new FulfillmentOrderNotFound({
        orderId,
        messageKey: 'fulfillment.orderNotFound',
      }),
  );

export const ensurePickableOrder = (order: Order, orderId: string) =>
  PICKABLE_STATUSES.includes(order.status)
    ? Effect.void
    : Effect.fail(
        new FulfillmentInvalidTransition({
          orderId,
          from: order.status,
          to: OrderStatus.PICKING,
          messageKey: 'fulfillment.notPickable',
        }),
      );

export const pickOrder = ({
  repositories,
  input,
}: {
  readonly repositories: FulfillmentPickRepositories;
  readonly input: FulfillmentPickInput;
}): Effect.Effect<OrderFulfillmentView, FulfillmentError> =>
  Effect.gen(function* () {
    const order = yield* loadFulfillmentOrderOrFail(
      repositories.ordersRepository,
      input.orderId,
    );
    yield* ensurePickableOrder(order, input.orderId);

    if (order.status === OrderStatus.CONFIRMED) {
      yield* repositories.ordersRepository
        .transitionStatus(input.orderId, OrderStatus.CONFIRMED, {
          status: OrderStatus.PICKING,
        })
        .pipe(
          Effect.mapError(
            wrapFulfillmentInfrastructureError('transition to picking'),
          ),
          Effect.filterOrFail(Boolean, () =>
            new OrderStatusTransitionConflict({
              orderId: input.orderId,
              from: OrderStatus.CONFIRMED,
              to: OrderStatus.PICKING,
              messageKey: 'orders.statusTransitionConflict',
            }),
          ),
        );
    }

    const itemIds = input.picks.map((p) => p.orderItemId);
    const items = yield* repositories.orderItemsRepository
      .findByIds(itemIds)
      .pipe(
        Effect.mapError(wrapFulfillmentInfrastructureError('load order items')),
      );
    const itemMap = new Map((items ?? []).map((item) => [item.id, item]));

    for (const pick of input.picks) {
      const item = itemMap.get(pick.orderItemId);
      if (!item || item.order_id !== input.orderId) {
        return yield* Effect.fail(
          new FulfillmentPickFailed({
            orderItemId: pick.orderItemId,
            messageKey: 'fulfillment.orderItemNotFound',
          }),
        );
      }

      yield* repositories.inventoryRepository
        .adjustQuantity(pick.inventoryId, -pick.quantity)
        .pipe(
          Effect.mapError(
            wrapFulfillmentInfrastructureError('decrement inventory'),
          ),
          Effect.filterOrFail(
            (rows) => rows !== 0,
            () =>
              new FulfillmentPickFailed({
                orderItemId: pick.orderItemId,
                messageKey: 'fulfillment.insufficientInventory',
              }),
          ),
        );

      yield* repositories.orderItemsRepository
        .incrementPicked(pick.orderItemId, pick.quantity)
        .pipe(
          Effect.mapError(
            wrapFulfillmentInfrastructureError('increment quantity_picked'),
          ),
          Effect.filterOrFail(
            (rows) => rows !== 0,
            () =>
              new FulfillmentPickFailed({
                orderItemId: pick.orderItemId,
                messageKey: 'fulfillment.overPick',
              }),
          ),
        );

      const inventory = yield* repositories.inventoryRepository
        .findByIdWithRelations(pick.inventoryId)
        .pipe(
          Effect.mapError(wrapFulfillmentInfrastructureError('load inventory')),
        );

      yield* repositories.stockMovementsRepository
        .create({
          product_id: item.product_id,
          from_location_id: inventory?.location_id ?? null,
          quantity: pick.quantity,
          reason: StockMovementReason.SALE,
          order_id: input.orderId,
          user_id: input.actorId,
        })
        .pipe(
          Effect.mapError(
            wrapFulfillmentInfrastructureError('create stock movement'),
          ),
        );
    }

    const updated = yield* loadFulfillmentOrderOrFail(
      repositories.ordersRepository,
      input.orderId,
    );
    return toFulfillmentView(updated);
  });
