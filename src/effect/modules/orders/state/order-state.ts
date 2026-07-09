import { OrderStatus } from '@stocket/types/orders';
import type { OrderRow } from '../types';

type OrderStatusTimestampField = Extract<
  keyof OrderRow,
  'confirmed_at' | 'shipped_at' | 'delivered_at'
>;

export abstract class OrderState {
  abstract readonly status: OrderStatus;
  abstract readonly validTransitions: readonly OrderStatus[];
  readonly timestampField: OrderStatusTimestampField | null = null;

  validateTransition(target: OrderStatus): void {
    if (!this.validTransitions.includes(target)) {
      throw new Error(`Cannot transition from ${this.status} to ${target}`);
    }
  }

  validateEntry(_order: OrderRow): void {
    // No-op by default. Override in subclasses to add entry guards
    // e.g. ShippedState could verify all items are packed.
  }
}

class DraftState extends OrderState {
  readonly status = OrderStatus.DRAFT;
  readonly validTransitions = [
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
  ] as const;
}

class ConfirmedState extends OrderState {
  readonly status = OrderStatus.CONFIRMED;
  readonly validTransitions = [
    OrderStatus.SOURCING,
    OrderStatus.ON_HOLD,
    OrderStatus.CANCELLED,
  ] as const;
  readonly timestampField = 'confirmed_at' as const;
}

class SourcingState extends OrderState {
  readonly status = OrderStatus.SOURCING;
  readonly validTransitions = [
    OrderStatus.PICKING,
    OrderStatus.ON_HOLD,
    OrderStatus.CANCELLED,
  ] as const;
}

class PickingState extends OrderState {
  readonly status = OrderStatus.PICKING;
  readonly validTransitions = [
    OrderStatus.PACKED,
    OrderStatus.ON_HOLD,
    OrderStatus.CANCELLED,
  ] as const;
}

class PackedState extends OrderState {
  readonly status = OrderStatus.PACKED;
  readonly validTransitions = [
    OrderStatus.SHIPPED,
    OrderStatus.ON_HOLD,
    OrderStatus.CANCELLED,
  ] as const;
}

class ShippedState extends OrderState {
  readonly status = OrderStatus.SHIPPED;
  readonly validTransitions = [OrderStatus.DELIVERED] as const;
  readonly timestampField = 'shipped_at' as const;
}

class DeliveredState extends OrderState {
  readonly status = OrderStatus.DELIVERED;
  readonly validTransitions = [] as const;
  readonly timestampField = 'delivered_at' as const;
}

class CancelledState extends OrderState {
  readonly status = OrderStatus.CANCELLED;
  readonly validTransitions = [] as const;
}

class OnHoldState extends OrderState {
  readonly status = OrderStatus.ON_HOLD;
  readonly validTransitions = [
    OrderStatus.CONFIRMED,
    OrderStatus.SOURCING,
    OrderStatus.PICKING,
    OrderStatus.PACKED,
    OrderStatus.CANCELLED,
  ] as const;
}

const stateRegistry = {
  [OrderStatus.DRAFT]: new DraftState(),
  [OrderStatus.CONFIRMED]: new ConfirmedState(),
  [OrderStatus.SOURCING]: new SourcingState(),
  [OrderStatus.PICKING]: new PickingState(),
  [OrderStatus.PACKED]: new PackedState(),
  [OrderStatus.SHIPPED]: new ShippedState(),
  [OrderStatus.DELIVERED]: new DeliveredState(),
  [OrderStatus.CANCELLED]: new CancelledState(),
  [OrderStatus.ON_HOLD]: new OnHoldState(),
} as const satisfies Record<OrderStatus, OrderState>;

export function getOrderState(status: OrderStatus): OrderState {
  return stateRegistry[status];
}
