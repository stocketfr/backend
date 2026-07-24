import { Effect } from 'effect';
import type { OrderFulfillmentView } from '@stocket/types/fulfillment';
import { OrderStatus } from '@stocket/types/orders';
import { OrderStatusTransitionConflict } from '../orders/orders.errors';
import type { Order } from '../orders/types';
import { FulfillmentInvalidTransition, type FulfillmentError } from './errors';
import {
  loadFulfillmentOrderOrFail,
  wrapFulfillmentInfrastructureError,
} from './pick';
import { toFulfillmentView } from './mappers';

export interface FulfillmentConfirmRepository {
  readonly findByIdWithRelations: (
    orderId: string,
  ) => Effect.Effect<Order | null, unknown>;
  readonly transitionStatus: (
    orderId: string,
    expectedStatus: OrderStatus,
    data: {
      readonly status: OrderStatus;
      readonly confirmed_at: Date;
      readonly assigned_to: string;
    },
  ) => Effect.Effect<boolean, unknown>;
}

interface ConfirmOrderOptions {
  readonly repository: FulfillmentConfirmRepository;
  readonly orderId: string;
  readonly actorId: string;
  readonly now: () => Date;
}

export const confirmOrder = ({
  repository,
  orderId,
  actorId,
  now,
}: ConfirmOrderOptions): Effect.Effect<
  OrderFulfillmentView,
  FulfillmentError
> =>
  Effect.gen(function* () {
    const order = yield* loadFulfillmentOrderOrFail(repository, orderId);

    if (order.status !== OrderStatus.DRAFT) {
      return yield* Effect.fail(
        new FulfillmentInvalidTransition({
          orderId,
          from: order.status,
          to: OrderStatus.CONFIRMED,
          messageKey: 'fulfillment.onlyDraftCanConfirm',
        }),
      );
    }

    yield* repository
      .transitionStatus(
        orderId,
        OrderStatus.DRAFT,
        {
          status: OrderStatus.CONFIRMED,
          confirmed_at: now(),
          assigned_to: actorId,
        },
      )
      .pipe(
        Effect.mapError(wrapFulfillmentInfrastructureError('confirm order')),
        Effect.filterOrFail(Boolean, () =>
          new OrderStatusTransitionConflict({
            orderId,
            from: OrderStatus.DRAFT,
            to: OrderStatus.CONFIRMED,
            messageKey: 'orders.statusTransitionConflict',
          }),
        ),
      );

    const updated = yield* loadFulfillmentOrderOrFail(repository, orderId);
    return toFulfillmentView(updated);
  });
