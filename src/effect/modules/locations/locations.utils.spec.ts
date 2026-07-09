import { describe, expect, it } from '@effect/vitest';
import { LocationType } from '@stocket/types/locations';
import {
  toLocationCreateValues,
  toLocationUpdateValues,
} from './locations.utils';

describe('locations utils', () => {
  it('maps create DTO optional fields to persisted defaults', () => {
    const values = toLocationCreateValues({
      name: 'Warehouse A',
      type: LocationType.WAREHOUSE,
    });

    expect(values).toEqual({
      name: 'Warehouse A',
      type: LocationType.WAREHOUSE,
      address: '',
      contact_person: '',
      phone: '',
      is_active: true,
    });
  });

  it('keeps provided create fields', () => {
    const values = toLocationCreateValues({
      name: 'Client Dock',
      type: LocationType.CLIENT,
      address: '1 Port Way',
      contact_person: 'Jane Doe',
      phone: '+33123456789',
      is_active: false,
    });

    expect(values).toEqual({
      name: 'Client Dock',
      type: LocationType.CLIENT,
      address: '1 Port Way',
      contact_person: 'Jane Doe',
      phone: '+33123456789',
      is_active: false,
    });
  });

  it('maps update DTOs by dropping undefined fields only', () => {
    const values = toLocationUpdateValues({
      name: 'Updated Warehouse',
      address: '',
      phone: undefined,
      is_active: false,
    });

    expect(values).toEqual({
      name: 'Updated Warehouse',
      address: '',
      is_active: false,
    });
  });
});
