import { describe, expect, it } from '@effect/vitest';
import { toProductResponseDto } from './mappers';
import type { Product } from './types';

const now = new Date('2026-01-01T00:00:00.000Z');

const product = {
  id: '00000000-0000-4000-8000-000000000001',
  tenant_id: '00000000-0000-4000-8000-000000000010',
  sku: 'SKU-001',
  name: 'Orange Juice',
  description: 'Fresh',
  category_id: '00000000-0000-4000-8000-000000000002',
  category: {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Drinks',
    parent_id: null,
  },
  volume_ml: 750,
  weight_kg: 1.2,
  dimensions_cm: '10x10x20',
  standard_cost: 8,
  standard_price: 12,
  markup_percentage: 50,
  reorder_point: 10,
  primary_supplier_id: '00000000-0000-4000-8000-000000000003',
  primary_supplier: {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Best Supplies',
  },
  supplier_sku: 'SUP-1',
  barcode: '1234567890',
  unit: 'bottle',
  is_active: true,
  is_perishable: true,
  notes: 'Keep cold',
  created_at: now,
  updated_at: now,
  deleted_at: null,
  created_by: 'user-1',
  updated_by: 'user-2',
  deleted_by: null,
} satisfies Product;

describe('product mappers', () => {
  it('maps product relations to the response contract', () => {
    expect(toProductResponseDto(product)).toMatchObject({
      id: product.id,
      sku: 'SKU-001',
      category: { name: 'Drinks' },
      primary_supplier: { name: 'Best Supplies' },
      standard_price: 12,
    });
  });
});
