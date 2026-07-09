import { describe, expect, it } from '@effect/vitest';
import { toSupplierResponseDto } from './mappers';
import type { SupplierEntity } from './types';

const now = new Date('2026-01-01T00:00:00.000Z');

const supplier = {
  id: '00000000-0000-4000-8000-000000000001',
  tenant_id: '00000000-0000-4000-8000-000000000010',
  name: 'Best Supplies',
  contact_person: 'Jane Doe',
  email: 'jane@supplier.test',
  phone: '+33123456789',
  address: '1 Supplier Way',
  website: 'https://supplier.test',
  notes: 'Preferred',
  is_active: true,
  created_at: now,
  updated_at: now,
} satisfies SupplierEntity;

describe('supplier mappers', () => {
  it('maps a supplier row to the response contract', () => {
    expect(toSupplierResponseDto(supplier)).toEqual({
      id: supplier.id,
      name: 'Best Supplies',
      contact_person: 'Jane Doe',
      email: 'jane@supplier.test',
      phone: '+33123456789',
      address: '1 Supplier Way',
      website: 'https://supplier.test',
      notes: 'Preferred',
      is_active: true,
      created_at: now,
      updated_at: now,
    });
  });
});
