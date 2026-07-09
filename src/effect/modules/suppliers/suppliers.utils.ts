import { pickDefined } from '../../platform/effect/pick-defined';
import type {
  CreateSupplierDto,
  SupplierCreateValues,
  SupplierUpdateValues,
  UpdateSupplierDto,
} from './types';

export const toSupplierCreateValues = (
  dto: CreateSupplierDto,
): SupplierCreateValues => ({
  name: dto.name,
  contact_person: dto.contact_person ?? null,
  email: dto.email ?? null,
  phone: dto.phone ?? null,
  address: dto.address ?? null,
  website: dto.website ?? null,
  notes: dto.notes ?? null,
  is_active: dto.is_active ?? true,
});

export const toSupplierUpdateValues = (
  dto: UpdateSupplierDto,
): SupplierUpdateValues =>
  pickDefined<SupplierUpdateValues>([
    ['name', dto.name],
    ['contact_person', dto.contact_person],
    ['email', dto.email],
    ['phone', dto.phone],
    ['address', dto.address],
    ['website', dto.website],
    ['notes', dto.notes],
    ['is_active', dto.is_active],
  ]);
