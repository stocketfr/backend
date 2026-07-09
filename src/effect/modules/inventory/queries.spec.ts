import type { InventoryQueryDto } from '@stocket/types/inventory';
import { buildInventoryFilters, mapInventoryRow } from './queries';

describe('inventory queries', () => {
  it('builds one predicate for each active inventory filter', () => {
    const query: InventoryQueryDto = {
      product_id: '00000000-0000-4000-8000-000000000001',
      location_id: '00000000-0000-4000-8000-000000000002',
      area_id: '00000000-0000-4000-8000-000000000003',
      search: 'orange',
      low_stock: true,
      expiring_soon: true,
      min_quantity: 1,
      max_quantity: 10,
    };

    expect(buildInventoryFilters(query)).toHaveLength(7);
  });

  it('uses a single range predicate for min and max quantity together', () => {
    expect(
      buildInventoryFilters({ min_quantity: 1, max_quantity: 10 }),
    ).toHaveLength(1);
    expect(buildInventoryFilters({ min_quantity: 1 })).toHaveLength(1);
    expect(buildInventoryFilters({ max_quantity: 10 })).toHaveLength(1);
  });

  it('maps joined inventory rows into the relation shape used by services', () => {
    const inventoryRow = {
      id: '00000000-0000-4000-8000-000000000004',
      tenant_id: '00000000-0000-4000-8000-000000000005',
      product_id: '00000000-0000-4000-8000-000000000001',
      location_id: '00000000-0000-4000-8000-000000000002',
      area_id: null,
      quantity: 5,
      batch_number: 'BATCH-1',
      expiry_date: null,
      cost_per_unit: 9.5,
      received_date: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-02T00:00:00.000Z'),
    };
    const row = {
      inv: inventoryRow,
      product: null,
      location: null,
      area: null,
    } satisfies Parameters<typeof mapInventoryRow>[0];

    expect(mapInventoryRow(row)).toEqual({
      ...inventoryRow,
      product: null,
      location: null,
      area: null,
    });
  });
});
