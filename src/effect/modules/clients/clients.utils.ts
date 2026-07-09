import type {
  ClientCreateValues,
  ClientUpdateValues,
  CreateClientDto,
  UpdateClientDto,
} from './types';
import { pickDefined } from '../../platform/effect/pick-defined';

export const toClientCreateValues = (
  dto: CreateClientDto,
): ClientCreateValues => ({
  company_name: dto.company_name,
  contact_person: dto.contact_person,
  email: dto.email,
  yacht_name: dto.yacht_name ?? null,
  phone: dto.phone ?? null,
  billing_address: dto.billing_address ?? null,
  default_delivery_address: dto.default_delivery_address ?? null,
  ...(dto.account_status === undefined
    ? {}
    : { account_status: dto.account_status }),
  payment_terms: dto.payment_terms ?? null,
  credit_limit: dto.credit_limit ?? null,
  notes: dto.notes ?? null,
});

export const toClientUpdateValues = (
  dto: UpdateClientDto,
): ClientUpdateValues =>
  pickDefined<ClientUpdateValues>([
    ['company_name', dto.company_name],
    ['contact_person', dto.contact_person],
    ['email', dto.email],
    ['yacht_name', dto.yacht_name],
    ['phone', dto.phone],
    ['billing_address', dto.billing_address],
    ['default_delivery_address', dto.default_delivery_address],
    ['account_status', dto.account_status],
    ['payment_terms', dto.payment_terms],
    ['credit_limit', dto.credit_limit],
    ['notes', dto.notes],
  ]);
