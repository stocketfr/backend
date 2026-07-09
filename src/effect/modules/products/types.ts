import type { Schema } from 'effect';
import type {
  BulkCreateProductsSchema,
  BulkDeleteSchema,
  BulkRestoreSchema,
  BulkUpdateStatusSchema,
  CreateProductRequestSchema,
  ProductQuerySchema,
  UpdateProductRequestSchema,
} from '@stocket/types/products';
import type { categories, products, suppliers } from '../../platform/db/schema';

export type ProductQueryDto = Schema.Schema.Type<typeof ProductQuerySchema>;
export type CreateProductDto = Schema.Schema.Type<
  typeof CreateProductRequestSchema
>;
export type UpdateProductDto = Schema.Schema.Type<
  typeof UpdateProductRequestSchema
>;
export type BulkCreateProductsDto = Schema.Schema.Type<
  typeof BulkCreateProductsSchema
>;
export type BulkUpdateStatusDto = Schema.Schema.Type<
  typeof BulkUpdateStatusSchema
>;
export type BulkDeleteDto = Schema.Schema.Type<typeof BulkDeleteSchema>;
export type BulkRestoreDto = Schema.Schema.Type<typeof BulkRestoreSchema>;

export type ProductRow = typeof products.$inferSelect;
export type ProductInsert = typeof products.$inferInsert;
export type Product = ProductRow & {
  readonly category?: {
    readonly id: string;
    readonly name: string;
    readonly parent_id: string | null;
  } | null;
  readonly primary_supplier?: {
    readonly id: string;
    readonly name: string;
  } | null;
};

export type ProductWithRelations = ProductRow & {
  readonly category: typeof categories.$inferSelect | null;
  readonly primary_supplier: typeof suppliers.$inferSelect | null;
};

export interface ProductJoinRow {
  readonly product: ProductRow;
  readonly category: typeof categories.$inferSelect | null;
  readonly supplier: typeof suppliers.$inferSelect | null;
}
