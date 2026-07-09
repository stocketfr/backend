import { describe, expect, it } from '@effect/vitest';
import { StockMovementReason } from '@stocket/types/stock-movements';
import { toStockMovementCreateValues } from './stock-movements.utils';

describe('stock movement utils', () => {
  it('maps create DTO optional fields to nullable persisted values', () => {
    const values = toStockMovementCreateValues(
      {
        product_id: 'product-1',
        quantity: 3,
        reason: StockMovementReason.COUNT_CORRECTION,
      },
      'user-1',
    );

    expect(values).toEqual({
      product_id: 'product-1',
      from_location_id: null,
      to_location_id: null,
      quantity: 3,
      reason: StockMovementReason.COUNT_CORRECTION,
      order_id: null,
      reference_number: null,
      cost_per_unit: null,
      notes: null,
      user_id: 'user-1',
    });
  });

  it('keeps provided create fields', () => {
    const values = toStockMovementCreateValues(
      {
        product_id: 'product-1',
        from_location_id: 'location-1',
        to_location_id: 'location-2',
        quantity: 4,
        reason: StockMovementReason.INTERNAL_TRANSFER,
        order_id: 'order-1',
        reference_number: 'REF-1',
        cost_per_unit: 12.5,
        notes: 'Transfer',
      },
      'user-1',
    );

    expect(values).toEqual({
      product_id: 'product-1',
      from_location_id: 'location-1',
      to_location_id: 'location-2',
      quantity: 4,
      reason: StockMovementReason.INTERNAL_TRANSFER,
      order_id: 'order-1',
      reference_number: 'REF-1',
      cost_per_unit: 12.5,
      notes: 'Transfer',
      user_id: 'user-1',
    });
  });
});
