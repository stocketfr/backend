import type {
  PaginatedProductsResponseDto,
  ProductResponseDto,
} from '@stocket/types/products';
import type { ProductQueryDto, UpdateProductDto } from '../../products/types';
import type {
  ListProductsInput,
  McpProduct,
  McpProductSummary,
} from './schemas';

const toIsoString = (value: string | Date): string =>
  typeof value === 'string' ? value : value.toISOString();

const toOptionalIsoString = (
  value: string | Date | null | undefined,
): string | null => (value == null ? null : toIsoString(value));

export const toMcpProduct = (product: ProductResponseDto): McpProduct => ({
  id: product.id,
  sku: product.sku,
  name: product.name,
  description: product.description,
  category_id: product.category_id,
  category: product.category ?? null,
  volume_ml: product.volume_ml,
  weight_kg: product.weight_kg,
  dimensions_cm: product.dimensions_cm,
  standard_cost: product.standard_cost,
  standard_price: product.standard_price,
  markup_percentage: product.markup_percentage,
  reorder_point: product.reorder_point,
  primary_supplier_id: product.primary_supplier_id,
  primary_supplier: product.primary_supplier ?? null,
  supplier_sku: product.supplier_sku,
  barcode: product.barcode,
  unit: product.unit,
  is_active: product.is_active,
  is_perishable: product.is_perishable,
  notes: product.notes,
  archived_at: toOptionalIsoString(product.deleted_at),
  created_at: toIsoString(product.created_at),
  updated_at: toIsoString(product.updated_at),
});

export const toMcpProductSummary = (
  product: ProductResponseDto,
): McpProductSummary => ({
  id: product.id,
  sku: product.sku,
  name: product.name,
  category: product.category ?? null,
  is_active: product.is_active,
  archived_at: toOptionalIsoString(product.deleted_at),
  updated_at: toIsoString(product.updated_at),
});

export const toProductQuery = (input: ListProductsInput): ProductQueryDto => ({
  page: input.page,
  limit: input.limit,
  search: input.search,
  category_id: input.category_id,
  primary_supplier_id: input.primary_supplier_id,
  is_active: input.is_active,
  is_perishable: input.is_perishable,
  min_price: input.min_price,
  max_price: input.max_price,
  include_deleted: input.include_archived,
  sort_by: input.sort_by,
  sort_order: input.sort_order,
});

export const toMcpProductsPage = (response: PaginatedProductsResponseDto) => ({
  products: response.data.map(toMcpProductSummary),
  pagination: response.meta,
});

export const toUpdateProductDto = (
  product: ProductResponseDto,
): UpdateProductDto => ({
  sku: product.sku,
  name: product.name,
  description: product.description,
  category_id: product.category_id,
  volume_ml: product.volume_ml,
  weight_kg: product.weight_kg,
  dimensions_cm: product.dimensions_cm,
  standard_cost: product.standard_cost,
  standard_price: product.standard_price,
  markup_percentage: product.markup_percentage,
  reorder_point: product.reorder_point,
  primary_supplier_id: product.primary_supplier_id,
  supplier_sku: product.supplier_sku,
  barcode: product.barcode,
  unit: product.unit,
  is_active: product.is_active,
  is_perishable: product.is_perishable,
  notes: product.notes,
});
