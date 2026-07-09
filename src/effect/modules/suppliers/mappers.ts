import type { SupplierResponseDto } from '@stocket/types/suppliers';
import type { SupplierEntity } from './types';

export function toSupplierResponseDto(
  supplier: SupplierEntity,
): SupplierResponseDto {
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
