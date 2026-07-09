import type {
  CreateLocationDto,
  UpdateLocationDto,
} from '@stocket/types/locations';
import { pickDefined } from '../../platform/effect/pick-defined';
import type { LocationCreateValues, LocationUpdateValues } from './types';

export const toLocationCreateValues = (
  dto: CreateLocationDto,
): LocationCreateValues => ({
  name: dto.name,
  type: dto.type,
  address: dto.address ?? '',
  contact_person: dto.contact_person ?? '',
  phone: dto.phone ?? '',
  is_active: dto.is_active ?? true,
});

export const toLocationUpdateValues = (
  dto: UpdateLocationDto,
): LocationUpdateValues =>
  pickDefined<LocationUpdateValues>([
    ['name', dto.name],
    ['type', dto.type],
    ['address', dto.address],
    ['contact_person', dto.contact_person],
    ['phone', dto.phone],
    ['is_active', dto.is_active],
  ]);
