import type { ClientResponseDto } from '@stocket/types/clients';
import type { ClientEntity } from './types';

export function toClientResponseDto(client: ClientEntity): ClientResponseDto {
  return {
    id: client.id,
    company_name: client.company_name,
    contact_person: client.contact_person,
    email: client.email,
    yacht_name: client.yacht_name,
    phone: client.phone,
    billing_address: client.billing_address,
    default_delivery_address: client.default_delivery_address,
    account_status: client.account_status,
    payment_terms: client.payment_terms,
    credit_limit: client.credit_limit,
    notes: client.notes,
    created_at: client.created_at,
    updated_at: client.updated_at,
  };
}
