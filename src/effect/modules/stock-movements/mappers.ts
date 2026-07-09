import type { StockMovementResponseDto } from '@stocket/types/stock-movements';
import type { StockMovementWithRelations } from './types';

export function toStockMovementResponseDto(
  sm: StockMovementWithRelations,
): StockMovementResponseDto {
  return {
    id: sm.id,
    product_id: sm.product_id,
    product: sm.product
      ? { id: sm.product.id, name: sm.product.name, sku: sm.product.sku }
      : null,
    from_location_id: sm.from_location_id,
    from_location: sm.fromLocation
      ? { id: sm.fromLocation.id, name: sm.fromLocation.name }
      : null,
    to_location_id: sm.to_location_id,
    to_location: sm.toLocation
      ? { id: sm.toLocation.id, name: sm.toLocation.name }
      : null,
    quantity: sm.quantity,
    reason: sm.reason,
    order_id: sm.order_id,
    reference_number: sm.reference_number,
    cost_per_unit: sm.cost_per_unit,
    user_id: sm.user_id,
    notes: sm.notes,
    created_at: sm.created_at,
  };
}
