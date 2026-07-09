import type { locations } from '../../platform/db/schema';

export type LocationEntity = typeof locations.$inferSelect;

export interface LocationCreateValues {
  readonly name: string;
  readonly type: LocationEntity['type'];
  readonly address: string;
  readonly contact_person: string;
  readonly phone: string;
  readonly is_active: boolean;
}

export type LocationUpdateValues = Partial<LocationCreateValues>;
