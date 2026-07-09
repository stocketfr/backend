import type { LocationResponseDto } from '@stocket/types/locations';
import type { LocationEntity } from './types';

export function toLocationResponseDto(
  location: LocationEntity,
): LocationResponseDto {
  return {
    id: location.id,
    name: location.name,
    type: location.type,
    address: location.address,
    contact_person: location.contact_person,
    phone: location.phone,
    is_active: location.is_active,
    created_at: location.created_at,
    updated_at: location.updated_at,
  };
}
