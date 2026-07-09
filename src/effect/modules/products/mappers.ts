import type { ProductResponseDto } from '@stocket/types/products';
import type { Product } from './types';

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
