import type { CreateProductDto, ProductInsert } from './types';

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
    barcode: dto.barcode ?? null,
    unit: dto.unit ?? null,
    notes: dto.notes ?? null,
    created_by: userId ?? null,
    updated_by: userId ?? null,
  };
}
