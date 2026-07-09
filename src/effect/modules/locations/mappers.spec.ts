import { describe, expect, it } from '@effect/vitest';
import { LocationType } from '@stocket/types/locations';
import { toLocationResponseDto } from './mappers';
import type { LocationEntity } from './types';

const now = new Date('2026-01-01T00:00:00.000Z');

const location = {
  id: '00000000-0000-4000-8000-000000000001',
  tenant_id: '00000000-0000-4000-8000-000000000010',
  name: 'Warehouse A',
  type: LocationType.WAREHOUSE,
  address: '1 Warehouse Way',
  contact_person: 'Jane Doe',
  phone: '+33123456789',
  is_active: true,
  created_at: now,
  updated_at: now,
} satisfies LocationEntity;

describe('location mappers', () => {
  it('maps a location row to the response contract', () => {
    expect(toLocationResponseDto(location)).toEqual({
      id: location.id,
      name: 'Warehouse A',
      type: LocationType.WAREHOUSE,
      address: '1 Warehouse Way',
      contact_person: 'Jane Doe',
      phone: '+33123456789',
      is_active: true,
      created_at: now,
      updated_at: now,
    });
  });
});
