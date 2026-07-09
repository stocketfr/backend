import type { Schema } from 'effect';
import type {
  AdjustInventorySchema,
  CreateInventorySchema,
  InventoryQuerySchema,
  UpdateInventorySchema,
} from '@stocket/types/inventory';
import type {
  areas,
  inventory,
  locations,
  products,
} from '../../platform/db/schema';

export type InventoryQueryDto = Schema.Schema.Type<typeof InventoryQuerySchema>;
export type CreateInventoryDto = Schema.Schema.Type<
  typeof CreateInventorySchema
>;
export type UpdateInventoryDto = Schema.Schema.Type<
  typeof UpdateInventorySchema
>;
export type AdjustInventoryDto = Schema.Schema.Type<
  typeof AdjustInventorySchema
>;

export type InventoryRow = typeof inventory.$inferSelect;
export type Inventory = InventoryRow & {
  readonly product?: {
    readonly id: string;
    readonly sku: string;
    readonly name: string;
    readonly unit: string | null;
  } | null;
  readonly location?: {
    readonly id: string;
    readonly name: string;
    readonly type: string;
  } | null;
  readonly area?: {
    readonly id: string;
    readonly name: string;
    readonly code: string;
  } | null;
};

export type InventoryWithRelations = InventoryRow & {
  readonly product: typeof products.$inferSelect | null;
  readonly location: typeof locations.$inferSelect | null;
  readonly area: typeof areas.$inferSelect | null;
};

export interface InventoryJoinRow {
  readonly inv: InventoryRow;
  readonly product: typeof products.$inferSelect | null;
  readonly location: typeof locations.$inferSelect | null;
  readonly area: typeof areas.$inferSelect | null;
}
