import { describe, expect, it } from '@effect/vitest';
import { ClientStatus } from '@stocket/types/clients';
import { toClientResponseDto } from './mappers';
import type { ClientEntity } from './types';

const now = new Date('2026-01-01T00:00:00.000Z');

const client = {
  id: '00000000-0000-4000-8000-000000000001',
  tenant_id: '00000000-0000-4000-8000-000000000010',
  company_name: 'Acme Corp',
  yacht_name: 'Sea Breeze',
  contact_person: 'Jane Doe',
  email: 'jane@acme.test',
  phone: '+33123456789',
  billing_address: '1 Port Way',
  default_delivery_address: 'Dock 2',
  account_status: ClientStatus.ACTIVE,
  payment_terms: 'Net 30',
  credit_limit: 5000,
  notes: 'VIP',
  created_at: now,
  updated_at: now,
} satisfies ClientEntity;

describe('client mappers', () => {
  it('maps a client row to the response contract', () => {
    expect(toClientResponseDto(client)).toEqual({
      id: client.id,
      company_name: 'Acme Corp',
      contact_person: 'Jane Doe',
      email: 'jane@acme.test',
      yacht_name: 'Sea Breeze',
      phone: '+33123456789',
      billing_address: '1 Port Way',
      default_delivery_address: 'Dock 2',
      account_status: ClientStatus.ACTIVE,
      payment_terms: 'Net 30',
      credit_limit: 5000,
      notes: 'VIP',
      created_at: now,
      updated_at: now,
    });
  });
});
