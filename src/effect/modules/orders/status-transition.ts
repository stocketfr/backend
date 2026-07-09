import { Effect } from 'effect';
import type { OrderStatus } from '@stocket/types/orders';
import type { Order } from './types';
import { InvalidOrderStatusTransition } from './orders.errors';
import { getOrderState } from './state/order-state';

export const validateOrderStatusTransition = (
  order: Order,
  nextStatus: OrderStatus,
): Effect.Effect<void, InvalidOrderStatusTransition> =>
  Effect.try({
    try: () => {
      const currentState = getOrderState(order.status);
      const targetState = getOrderState(nextStatus);

      currentState.validateTransition(nextStatus);
      targetState.validateEntry(order);
    },
    catch: () =>
      new InvalidOrderStatusTransition({
        from: order.status,
        to: nextStatus,
        messageKey: 'orders.invalidStatusTransition',
        messageArgs: {
          from: order.status,
          to: nextStatus,
        },
      }),
  });

export const buildOrderStatusUpdate = (
  nextStatus: OrderStatus,
  now: Date,
): Partial<Order> => {
  const updateData: Partial<Order> = { status: nextStatus };
  const { timestampField } = getOrderState(nextStatus);
  if (timestampField) {
    updateData[timestampField] = now;
  }
  return updateData;
};
