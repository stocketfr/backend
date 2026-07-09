import type { InventoryResponseDto } from '@stocket/types/inventory';
import type { inventory } from '../../platform/db/schema';

type InventoryRow = typeof inventory.$inferSelect;
export type Inventory = InventoryRow & {
  product?: {
    id: string;
    sku: string;
    name: string;
    unit: string | null;
  } | null;
  location?: { id: string; name: string; type: string } | null;
  area?: { id: string; name: string; code: string } | null;
};

export function toInventoryResponseDto(
  inventory: Inventory,
): InventoryResponseDto {
  return {
    id: inventory.id,
    product_id: inventory.product_id,
    product: inventory.product
      ? {
          id: inventory.product.id,
          sku: inventory.product.sku,
          name: inventory.product.name,
          unit: inventory.product.unit,
        }
      : null,
    location_id: inventory.location_id,
    location: inventory.location
      ? {
          id: inventory.location.id,
          name: inventory.location.name,
          type: inventory.location.type,
        }
      : null,
    area_id: inventory.area_id,
    area: inventory.area
      ? {
          id: inventory.area.id,
          name: inventory.area.name,
          code: inventory.area.code,
        }
      : null,
    quantity: inventory.quantity,
    batchNumber: inventory.batch_number,
    expiry_date: inventory.expiry_date,
    cost_per_unit: inventory.cost_per_unit
      ? Number(inventory.cost_per_unit)
      : null,
    received_date: inventory.received_date,
    created_at: inventory.created_at,
    updated_at: inventory.updated_at,
  };
}
