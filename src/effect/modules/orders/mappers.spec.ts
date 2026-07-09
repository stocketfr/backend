import { describe, expect, it } from '@effect/vitest';
import { OrderStatus } from '@stocket/types/orders';
import { toOrderItemResponseDto, toOrderResponseDto } from './mappers';
import type { Order, OrderItem } from './types';

const now = new Date('2026-03-10T00:00:00.000Z');

const item = {
  id: '00000000-0000-4000-8000-000000000001',
  order_id: '00000000-0000-4000-8000-000000000002',
  product_id: '00000000-0000-4000-8000-000000000003',
  product: { name: 'Widget', sku: 'WGT-001' },
  quantity: 5,
  unit_price: 30,
  subtotal: 150,
  notes: null,
  quantity_picked: 1,
  quantity_packed: 0,
  created_at: now,
  updated_at: now,
} satisfies OrderItem;

const order = {
  id: '00000000-0000-4000-8000-000000000002',
  tenant_id: '00000000-0000-4000-8000-000000000010',
  order_number: 'ORD-20260310-00001',
  client_id: '00000000-0000-4000-8000-000000000004',
  client: { company_name: 'Acme Corp' },
  status: OrderStatus.DRAFT,
  delivery_address: '123 Harbor Dr',
  delivery_deadline: null,
  yacht_name: null,
  special_instructions: null,
  total_amount: 150,
  assigned_to: null,
  created_by: '00000000-0000-4000-8000-000000000005',
  confirmed_at: null,
  shipped_at: null,
  delivered_at: null,
  kanban_task_id: null,
  items: [item],
  created_at: now,
  updated_at: now,
} satisfies Order;

describe('order mappers', () => {
  it('maps an order item with product summary fields', () => {
    expect(toOrderItemResponseDto(item)).toMatchObject({
      id: item.id,
      product_name: 'Widget',
      product_sku: 'WGT-001',
      unit_price: 30,
      subtotal: 150,
    });
  });

  it('maps an order with client and item summaries', () => {
    expect(toOrderResponseDto(order)).toMatchObject({
      id: order.id,
      client_name: 'Acme Corp',
      total_amount: 150,
      items: [{ product_sku: 'WGT-001' }],
    });
  });
});
