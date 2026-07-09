import { describe, expect, it } from 'vitest';
import { OrderStatus } from '@stocket/types/orders';
import type { Order, OrderItem } from '../orders/types';
import { toFulfillmentView } from './mappers';

const now = new Date('2026-03-10T00:00:00.000Z');

const makeOrderItem = (
  overrides: Partial<OrderItem> & {
    readonly id: string;
    readonly product_id: string;
  },
): OrderItem => ({
  order_id: 'order-1',
  quantity: 5,
  unit_price: 30,
  subtotal: 150,
  notes: null,
  quantity_picked: 2,
  quantity_packed: 1,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
  id: 'order-1',
  tenant_id: 'tenant-1',
  order_number: 'ORD-20260310-00001',
  client_id: 'client-1',
  status: OrderStatus.PICKING,
  delivery_address: '123 Harbor Dr',
  delivery_deadline: null,
  yacht_name: null,
  special_instructions: null,
  total_amount: 150,
  assigned_to: 'user-2',
  created_by: 'user-1',
  confirmed_at: new Date('2026-03-10T10:00:00.000Z'),
  shipped_at: null,
  delivered_at: null,
  kanban_task_id: null,
  created_at: now,
  updated_at: now,
  client: { company_name: 'Acme Corp' },
  items: [
    makeOrderItem({
      id: 'item-1',
      product_id: 'product-1',
    }),
  ],
  ...overrides,
});

describe('toFulfillmentView', () => {
  it('maps order fulfillment fields and item quantities', () => {
    expect(toFulfillmentView(makeOrder())).toEqual({
      orderId: 'order-1',
      status: OrderStatus.PICKING,
      confirmedAt: new Date('2026-03-10T10:00:00.000Z'),
      shippedAt: null,
      deliveredAt: null,
      items: [
        {
          orderItemId: 'item-1',
          productId: 'product-1',
          quantity: 5,
          quantityPicked: 2,
          quantityPacked: 1,
        },
      ],
    });
  });

  it('treats missing order items as an empty fulfillment item list', () => {
    expect(toFulfillmentView(makeOrder({ items: undefined })).items).toEqual(
      [],
    );
  });
});
