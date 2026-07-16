import { Schema } from 'effect';
import { SortOrder } from '@stocket/types/common';
import {
  CreateProductRequestSchema,
  ProductIdSchema,
  ProductSortField,
  UpdateProductRequestSchema,
} from '@stocket/types/products';

const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(Schema.Number);

const CategorySummarySchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  parent_id: Schema.NullOr(Schema.UUID),
});

const SupplierSummarySchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
});

export const McpProductSchema = Schema.Struct({
  id: ProductIdSchema,
  sku: Schema.String,
  name: Schema.String,
  description: NullableString,
  category_id: Schema.UUID,
  category: Schema.NullOr(CategorySummarySchema),
  volume_ml: NullableNumber,
  weight_kg: NullableNumber,
  dimensions_cm: NullableString,
  standard_cost: NullableNumber,
  standard_price: NullableNumber,
  markup_percentage: NullableNumber,
  reorder_point: Schema.Number,
  primary_supplier_id: Schema.NullOr(Schema.UUID),
  primary_supplier: Schema.NullOr(SupplierSummarySchema),
  supplier_sku: NullableString,
  barcode: NullableString,
  unit: NullableString,
  is_active: Schema.Boolean,
  is_perishable: Schema.Boolean,
  notes: NullableString,
  archived_at: NullableString,
  created_at: Schema.String,
  updated_at: Schema.String,
});

export const ProductIdInputSchema = Schema.Struct({
  id: ProductIdSchema.annotations({
    description: 'The product ID returned by Stocket.',
  }),
});

export const GetProductInputSchema = Schema.Struct({
  ...ProductIdInputSchema.fields,
  include_archived: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }).annotations({
    description: 'Also find this product if it is currently in the trash.',
  }),
});

export const ListProductsInputSchema = Schema.Struct({
  page: Schema.optionalWith(
    Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
    { default: () => 1 },
  ).annotations({ description: 'Results page, starting at 1.' }),
  limit: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(1),
      Schema.lessThanOrEqualTo(100),
    ),
    { default: () => 20 },
  ).annotations({ description: 'Products per page, from 1 to 100.' }),
  search: Schema.optional(Schema.Trim).annotations({
    description:
      'Find products by name, SKU, barcode, or other searchable text.',
  }),
  category_id: Schema.optional(Schema.UUID).annotations({
    description: 'Only products in this category.',
  }),
  primary_supplier_id: Schema.optional(Schema.UUID).annotations({
    description: 'Only products supplied by this supplier.',
  }),
  is_active: Schema.optional(Schema.Boolean),
  is_perishable: Schema.optional(Schema.Boolean),
  min_price: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
  max_price: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
  include_archived: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }).annotations({ description: 'Include products that are in the trash.' }),
  sort_by: Schema.optionalWith(
    Schema.Literal(
      ProductSortField.NAME,
      ProductSortField.SKU,
      ProductSortField.CREATED_AT,
      ProductSortField.UPDATED_AT,
      ProductSortField.STANDARD_PRICE,
      ProductSortField.STANDARD_COST,
      ProductSortField.REORDER_POINT,
    ),
    { default: () => ProductSortField.NAME },
  ),
  sort_order: Schema.optionalWith(
    Schema.Literal(SortOrder.ASC, SortOrder.DESC),
    { default: () => SortOrder.ASC },
  ),
});

export const CreateProductInputSchema = CreateProductRequestSchema;

export const UpdateProductInputSchema = Schema.Struct({
  id: ProductIdSchema.annotations({
    description: 'The product to change.',
  }),
  changes: UpdateProductRequestSchema.annotations({
    description: 'Only the product fields that should change.',
  }),
});

const ArchiveUndoSchema = Schema.Struct({
  tool: Schema.Literal('products_archive'),
  arguments: ProductIdInputSchema,
  label: Schema.String,
  limitation: Schema.String,
});

const RestoreUndoSchema = Schema.Struct({
  tool: Schema.Literal('products_restore'),
  arguments: ProductIdInputSchema,
  label: Schema.String,
  limitation: Schema.String,
});

const UpdateUndoSchema = Schema.Struct({
  tool: Schema.Literal('products_update'),
  arguments: UpdateProductInputSchema,
  label: Schema.String,
  limitation: Schema.String,
});

export const McpUndoInstructionSchema = Schema.Union(
  ArchiveUndoSchema,
  RestoreUndoSchema,
  UpdateUndoSchema,
);

export const GetProductResultSchema = Schema.Struct({
  product: McpProductSchema,
});

export const ListProductsResultSchema = Schema.Struct({
  products: Schema.Array(McpProductSchema),
  pagination: Schema.Struct({
    page: Schema.Number,
    limit: Schema.Number,
    total: Schema.Number,
    total_pages: Schema.Number,
  }),
});

export const ProductMutationResultSchema = Schema.Struct({
  status: Schema.Literal(
    'created',
    'updated',
    'archived',
    'restored',
    'cancelled',
    'confirmation_required',
  ),
  product: McpProductSchema,
  message: Schema.String,
  undo: Schema.optional(McpUndoInstructionSchema),
});

export type ListProductsInput = Schema.Schema.Type<
  typeof ListProductsInputSchema
>;
export type ProductIdInput = Schema.Schema.Type<typeof ProductIdInputSchema>;
export type GetProductInput = Schema.Schema.Type<typeof GetProductInputSchema>;
export type CreateProductInput = Schema.Schema.Type<
  typeof CreateProductInputSchema
>;
export type UpdateProductInput = Schema.Schema.Type<
  typeof UpdateProductInputSchema
>;
export type McpProduct = Schema.Schema.Type<typeof McpProductSchema>;
export type ProductMutationResult = Schema.Schema.Type<
  typeof ProductMutationResultSchema
>;
