import { Effect } from 'effect';
import { describe, expect, it } from '@effect/vitest';
import { OrderStatus } from '@stocket/types/orders';
import type { Order } from './types';
import {
  buildOrderStatusUpdate,
  validateOrderStatusTransition,
} from './status-transition';

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
  id: 'order-1',
  tenant_id: 'tenant-1',
  order_number: 'ORD-20260310-00001',
  client_id: 'client-1',
  status: OrderStatus.DRAFT,
  delivery_address: '123 Harbor Dr',
  delivery_deadline: null,
  yacht_name: null,
  special_instructions: null,
  total_amount: 150,
  assigned_to: null,
  created_by: 'user-1',
  confirmed_at: null,
  shipped_at: null,
  delivered_at: null,
  kanban_task_id: null,
  created_at: new Date('2026-03-10T00:00:00.000Z'),
  updated_at: new Date('2026-03-10T00:00:00.000Z'),
  client: { company_name: 'Acme Corp' },
  items: [],
  ...overrides,
});

describe('validateOrderStatusTransition', () => {
  it.effect('allows valid state transitions', () =>
    validateOrderStatusTransition(
      makeOrder({ status: OrderStatus.DRAFT }),
      OrderStatus.CONFIRMED,
    ),
  );

  it.effect('maps invalid state-machine transitions to the order domain error', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateOrderStatusTransition(
          makeOrder({ status: OrderStatus.DELIVERED }),
          OrderStatus.DRAFT,
        ),
      );

      expect(error).toMatchObject({
        _tag: 'InvalidOrderStatusTransition',
        from: OrderStatus.DELIVERED,
        to: OrderStatus.DRAFT,
        messageArgs: {
          from: OrderStatus.DELIVERED,
          to: OrderStatus.DRAFT,
        },
      });
    }),
  );
});

describe('buildOrderStatusUpdate', () => {
  it('sets timestamp fields for timestamped target states', () => {
    const now = new Date('2026-03-10T10:00:00.000Z');

    expect(buildOrderStatusUpdate(OrderStatus.CONFIRMED, now)).toEqual({
      status: OrderStatus.CONFIRMED,
      confirmed_at: now,
    });
    expect(buildOrderStatusUpdate(OrderStatus.SHIPPED, now)).toEqual({
      status: OrderStatus.SHIPPED,
      shipped_at: now,
    });
    expect(buildOrderStatusUpdate(OrderStatus.DELIVERED, now)).toEqual({
      status: OrderStatus.DELIVERED,
      delivered_at: now,
    });
  });

  it('only sets status for target states without timestamps', () => {
    const now = new Date('2026-03-10T10:00:00.000Z');

    expect(buildOrderStatusUpdate(OrderStatus.PICKING, now)).toEqual({
      status: OrderStatus.PICKING,
    });
  });
});
