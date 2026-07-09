import type {
  CreateProductDto,
  ProductResponseDto,
} from '@stocket/types/products';
import type { products } from '../../platform/db/schema';

export type ProductRow = typeof products.$inferSelect;
export type ProductInsert = typeof products.$inferInsert;
type Product = ProductRow & {
  category?: { id: string; name: string; parent_id: string | null } | null;
  primary_supplier?: { id: string; name: string } | null;
};

export function toProductResponseDto(product: Product): ProductResponseDto {
  const dto: ProductResponseDto = {
    id: product.id,
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
    created_at: product.created_at,
    updated_at: product.updated_at,
    deleted_at: product.deleted_at,
    created_by: product.created_by,
    updated_by: product.updated_by,
    deleted_by: product.deleted_by,
  };

  if (product.category) {
    dto.category = {
      id: product.category.id,
      name: product.category.name,
      parent_id: product.category.parent_id,
    };
  }

  if (product.primary_supplier) {
    dto.primary_supplier = {
      id: product.primary_supplier.id,
      name: product.primary_supplier.name,
    };
  }

  return dto;
}

export function toCreateProductEntity(
  dto: CreateProductDto,
  userId?: string,
): ProductInsert {
  return {
    sku: dto.sku,
    name: dto.name,
    category_id: dto.category_id,
    reorder_point: dto.reorder_point,
    is_active: dto.is_active,
    is_perishable: dto.is_perishable,
    description: dto.description ?? null,
    volume_ml: dto.volume_ml ?? null,
    weight_kg: dto.weight_kg ?? null,
    dimensions_cm: dto.dimensions_cm ?? null,
    standard_cost: dto.standard_cost ?? null,
    standard_price: dto.standard_price ?? null,
    markup_percentage: dto.markup_percentage ?? null,
    primary_supplier_id: dto.primary_supplier_id ?? null,
    supplier_sku: dto.supplier_sku ?? null,
    notes: dto.notes ?? null,
    created_by: userId ?? null,
    updated_by: userId ?? null,
  };
}
