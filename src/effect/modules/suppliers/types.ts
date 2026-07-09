import type { Schema } from 'effect';
import type {
  CreateSupplierSchema,
  UpdateSupplierSchema,
} from '@stocket/types/suppliers';
import type { suppliers } from '../../platform/db/schema';

export type SupplierEntity = typeof suppliers.$inferSelect;
export type CreateSupplierDto = Schema.Schema.Type<typeof CreateSupplierSchema>;
export type UpdateSupplierDto = Schema.Schema.Type<typeof UpdateSupplierSchema>;

export interface SupplierCreateValues {
  readonly name: string;
  readonly contact_person: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  readonly website: string | null;
  readonly notes: string | null;
  readonly is_active: boolean;
}

export type SupplierUpdateValues = Partial<SupplierCreateValues>;
