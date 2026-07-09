import { SortOrder } from '@stocket/types/common';
import { ProductSortField } from '@stocket/types/products';
import {
  buildProductFilters,
  mapProductRow,
} from './queries';
import type { ProductQueryDto, ProductWithRelations } from './types';

const query = (overrides: Partial<ProductQueryDto> = {}): ProductQueryDto => ({
  page: 1,
  limit: 20,
  include_deleted: false,
  sort_by: ProductSortField.NAME,
  sort_order: SortOrder.ASC,
  ...overrides,
});

describe('product queries', () => {
  it('builds one predicate for each active product filter', () => {
    const fullQuery = query({
      search: 'whisky',
      category_id: '00000000-0000-4000-8000-000000000001',
      primary_supplier_id: '00000000-0000-4000-8000-000000000002',
      is_active: true,
      is_perishable: false,
      min_price: 10,
      max_price: 30,
    });

    expect(buildProductFilters(fullQuery)).toHaveLength(6);
  });

  it('uses a single range predicate for min and max price together', () => {
    expect(
      buildProductFilters(query({ min_price: 10, max_price: 30 })),
    ).toHaveLength(1);
    expect(buildProductFilters(query({ min_price: 10 }))).toHaveLength(1);
    expect(buildProductFilters(query({ max_price: 30 }))).toHaveLength(1);
  });

  it('maps joined product rows into the relation shape used by services', () => {
    const productRow = {
      id: '00000000-0000-4000-8000-000000000003',
      tenant_id: '00000000-0000-4000-8000-000000000004',
      sku: 'SKU-1',
      name: 'Whisky',
      description: null,
      category_id: '00000000-0000-4000-8000-000000000001',
      volume_ml: null,
      weight_kg: null,
      dimensions_cm: null,
      standard_cost: null,
      standard_price: null,
      markup_percentage: null,
      reorder_point: 10,
      primary_supplier_id: null,
      supplier_sku: null,
      barcode: null,
      unit: null,
      is_active: true,
      is_perishable: false,
      notes: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-02T00:00:00.000Z'),
      deleted_at: null,
      created_by: null,
      updated_by: null,
      deleted_by: null,
    };
    const row = {
      product: productRow,
      category: null,
      supplier: null,
    } satisfies Parameters<typeof mapProductRow>[0];

    expect(mapProductRow(row)).toEqual({
      ...productRow,
      category: null,
      primary_supplier: null,
    } satisfies ProductWithRelations);
  });
});
