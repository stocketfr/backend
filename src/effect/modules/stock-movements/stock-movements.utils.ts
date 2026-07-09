import type {
  CreateStockMovementDto,
  StockMovementCreateValues,
} from './types';

export const toStockMovementCreateValues = (
  dto: CreateStockMovementDto,
  userId: string,
): StockMovementCreateValues => ({
  product_id: dto.product_id,
  from_location_id: dto.from_location_id ?? null,
  to_location_id: dto.to_location_id ?? null,
  quantity: dto.quantity,
  reason: dto.reason,
  order_id: dto.order_id ?? null,
  reference_number: dto.reference_number ?? null,
  cost_per_unit: dto.cost_per_unit ?? null,
  notes: dto.notes ?? null,
  user_id: userId,
});
