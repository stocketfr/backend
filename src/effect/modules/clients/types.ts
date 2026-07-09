import type { Schema } from 'effect';
import type {
  CreateClientSchema,
  UpdateClientSchema,
} from '@stocket/types/clients';
import type { clients } from '../../platform/db/schema';

export type ClientEntity = typeof clients.$inferSelect;
export type CreateClientDto = Schema.Schema.Type<typeof CreateClientSchema>;
export type UpdateClientDto = Schema.Schema.Type<typeof UpdateClientSchema>;

export interface ClientCreateValues {
  readonly company_name: string;
  readonly contact_person: string;
  readonly email: string;
  readonly yacht_name: string | null;
  readonly phone: string | null;
  readonly billing_address: string | null;
  readonly default_delivery_address: string | null;
  readonly account_status?: ClientEntity['account_status'];
  readonly payment_terms: string | null;
  readonly credit_limit: number | null;
  readonly notes: string | null;
}

export type ClientUpdateValues = Partial<ClientCreateValues>;
