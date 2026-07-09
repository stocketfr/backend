import { describe, expect, it } from '@effect/vitest';
import { toInventoryResponseDto } from './mappers';
import type { Inventory } from './types';

const now = new Date('2026-01-01T00:00:00.000Z');

const inventory = {
  id: '00000000-0000-4000-8000-000000000001',
  tenant_id: '00000000-0000-4000-8000-000000000010',
  product_id: '00000000-0000-4000-8000-000000000002',
  product: {
    id: '00000000-0000-4000-8000-000000000002',
    sku: 'SKU-1',
    name: 'Orange Juice',
    unit: 'bottle',
  },
  location_id: '00000000-0000-4000-8000-000000000003',
  location: {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Warehouse A',
    type: 'WAREHOUSE',
  },
  area_id: '00000000-0000-4000-8000-000000000004',
  area: {
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Cold Room',
    code: 'COLD',
  },
  quantity: 25,
  batch_number: 'BATCH-1',
  expiry_date: new Date('2026-05-01T00:00:00.000Z'),
  cost_per_unit: 9.5,
  received_date: new Date('2026-01-10T00:00:00.000Z'),
  created_at: now,
  updated_at: now,
} satisfies Inventory;

describe('inventory mappers', () => {
  it('maps inventory relations and numeric cost to the response contract', () => {
    expect(toInventoryResponseDto(inventory)).toMatchObject({
      id: inventory.id,
      product: { sku: 'SKU-1', unit: 'bottle' },
      location: { name: 'Warehouse A' },
      area: { code: 'COLD' },
      batchNumber: 'BATCH-1',
      cost_per_unit: 9.5,
    });
  });
});
