import type { Schema } from 'effect';
import type { CreateStockMovementSchema } from '@stocket/types/stock-movements';
import type { stockMovements } from '../../platform/db/schema';

export type CreateStockMovementDto = Schema.Schema.Type<
  typeof CreateStockMovementSchema
>;

export type StockMovementRow = typeof stockMovements.$inferSelect;

export type StockMovementWithRelations = StockMovementRow & {
  readonly product: {
    readonly id: string;
    readonly name: string;
    readonly sku: string;
  } | null;
  readonly fromLocation: { readonly id: string; readonly name: string } | null;
  readonly toLocation: { readonly id: string; readonly name: string } | null;
};

export interface StockMovementCreateValues {
  readonly product_id: string;
  readonly from_location_id: string | null;
  readonly to_location_id: string | null;
  readonly quantity: number;
  readonly reason: StockMovementRow['reason'];
  readonly order_id: string | null;
  readonly reference_number: string | null;
  readonly cost_per_unit: number | null;
  readonly notes: string | null;
  readonly user_id: string;
}
