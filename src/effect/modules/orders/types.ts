import type { Schema } from 'effect';
import type {
  CreateOrderSchema,
  OrderQuerySchema,
  UpdateOrderSchema,
  UpdateOrderStatusSchema,
} from '@stocket/types/orders';
import type { orderItems, orders } from '../../platform/db/schema';

export type OrderQueryDto = Schema.Schema.Type<typeof OrderQuerySchema>;
export type CreateOrderDto = Schema.Schema.Type<typeof CreateOrderSchema>;
export type UpdateOrderDto = Schema.Schema.Type<typeof UpdateOrderSchema>;
export type UpdateOrderStatusDto = Schema.Schema.Type<
  typeof UpdateOrderStatusSchema
>;

export type OrderItemRow = typeof orderItems.$inferSelect;
export type OrderItem = OrderItemRow & {
  readonly product?: { readonly name: string; readonly sku: string } | null;
};

export type OrderRow = typeof orders.$inferSelect;
export type Order = OrderRow & {
  readonly client?: { readonly company_name: string } | null;
  readonly items?: readonly OrderItem[];
};
