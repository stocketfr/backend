import { describe, expect, it } from '@effect/vitest';
import { StockMovementReason } from '@stocket/types/stock-movements';
import { toStockMovementResponseDto } from './mappers';
import type { StockMovementWithRelations } from './types';

const createdAt = new Date('2026-01-01T00:00:00.000Z');

const movement = {
  id: '00000000-0000-4000-8000-000000000001',
  tenant_id: '00000000-0000-4000-8000-000000000010',
  product_id: '00000000-0000-4000-8000-000000000002',
  product: {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Orange Juice',
    sku: 'OJ-001',
  },
  from_location_id: '00000000-0000-4000-8000-000000000003',
  fromLocation: {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Warehouse A',
  },
  to_location_id: '00000000-0000-4000-8000-000000000004',
  toLocation: {
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Store B',
  },
  quantity: 12,
  reason: StockMovementReason.INTERNAL_TRANSFER,
  order_id: null,
  reference_number: 'REF-001',
  cost_per_unit: 4.5,
  kanban_task_id: null,
  user_id: '00000000-0000-4000-8000-000000000005',
  notes: 'Move stock',
  created_at: createdAt,
} satisfies StockMovementWithRelations;

describe('stock movement mappers', () => {
  it('maps joined movement relations to the response contract', () => {
    expect(toStockMovementResponseDto(movement)).toMatchObject({
      id: movement.id,
      product: { sku: 'OJ-001' },
      from_location: { name: 'Warehouse A' },
      to_location: { name: 'Store B' },
      reason: StockMovementReason.INTERNAL_TRANSFER,
    });
  });
});
