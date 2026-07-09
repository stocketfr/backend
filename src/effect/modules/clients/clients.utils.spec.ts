import { describe, expect, it } from '@effect/vitest';
import { ClientStatus } from '@stocket/types/clients';
import { toClientCreateValues, toClientUpdateValues } from './clients.utils';

describe('clients utils', () => {
  it('maps create DTO optional fields to nullable persisted values', () => {
    const values = toClientCreateValues({
      company_name: 'Acme Corp',
      contact_person: 'Jane Doe',
      email: 'jane@acme.test',
    });

    expect(values).toEqual({
      company_name: 'Acme Corp',
      contact_person: 'Jane Doe',
      email: 'jane@acme.test',
      yacht_name: null,
      phone: null,
      billing_address: null,
      default_delivery_address: null,
      payment_terms: null,
      credit_limit: null,
      notes: null,
    });
    expect(values).not.toHaveProperty('account_status');
  });

  it('keeps provided create fields including explicit account status', () => {
    const values = toClientCreateValues({
      company_name: 'Acme Corp',
      contact_person: 'Jane Doe',
      email: 'jane@acme.test',
      yacht_name: 'Sea Breeze',
      phone: '+33123456789',
      billing_address: '1 Port Way',
      default_delivery_address: 'Dock 2',
      account_status: ClientStatus.SUSPENDED,
      payment_terms: 'Net 30',
      credit_limit: 5000,
      notes: 'Requires approval',
    });

    expect(values).toEqual({
      company_name: 'Acme Corp',
      contact_person: 'Jane Doe',
      email: 'jane@acme.test',
      yacht_name: 'Sea Breeze',
      phone: '+33123456789',
      billing_address: '1 Port Way',
      default_delivery_address: 'Dock 2',
      account_status: ClientStatus.SUSPENDED,
      payment_terms: 'Net 30',
      credit_limit: 5000,
      notes: 'Requires approval',
    });
  });

  it('maps update DTOs by dropping undefined fields only', () => {
    const values = toClientUpdateValues({
      company_name: 'Acme Updated',
      email: undefined,
      notes: '',
      credit_limit: 0,
    });

    expect(values).toEqual({
      company_name: 'Acme Updated',
      notes: '',
      credit_limit: 0,
    });
  });
});
