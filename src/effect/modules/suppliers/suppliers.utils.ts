import type { SupplierResponseDto } from '@stocket/types/suppliers';
import type { suppliers } from '../../platform/db/schema';

type Supplier = typeof suppliers.$inferSelect;

export function toSupplierResponseDto(supplier: Supplier): SupplierResponseDto {
  return {
    id: supplier.id,
    name: supplier.name,
    contact_person: supplier.contact_person,
    email: supplier.email,
    phone: supplier.phone,
    address: supplier.address,
    website: supplier.website,
    notes: supplier.notes,
    is_active: supplier.is_active,
    created_at: supplier.created_at,
    updated_at: supplier.updated_at,
  };
}
