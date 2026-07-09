import { describe, expect, it } from '@effect/vitest';
import {
  toSupplierCreateValues,
  toSupplierUpdateValues,
} from './suppliers.utils';

describe('suppliers utils', () => {
  it('maps create DTO optional fields to persisted defaults', () => {
    const values = toSupplierCreateValues({ name: 'Best Supplies' });

    expect(values).toEqual({
      name: 'Best Supplies',
      contact_person: null,
      email: null,
      phone: null,
      address: null,
      website: null,
      notes: null,
      is_active: true,
    });
  });

  it('keeps provided create fields', () => {
    const values = toSupplierCreateValues({
      name: 'Best Supplies',
      contact_person: 'Jane Doe',
      email: 'jane@supplier.test',
      phone: '+33123456789',
      address: '1 Supplier Way',
      website: 'https://supplier.test',
      notes: 'Preferred vendor',
      is_active: false,
    });

    expect(values).toEqual({
      name: 'Best Supplies',
      contact_person: 'Jane Doe',
      email: 'jane@supplier.test',
      phone: '+33123456789',
      address: '1 Supplier Way',
      website: 'https://supplier.test',
      notes: 'Preferred vendor',
      is_active: false,
    });
  });

  it('maps update DTOs by dropping undefined fields only', () => {
    const values = toSupplierUpdateValues({
      name: 'Updated Supplies',
      email: undefined,
      notes: '',
      is_active: false,
    });

    expect(values).toEqual({
      name: 'Updated Supplies',
      notes: '',
      is_active: false,
    });
  });
});
