import type { areas } from '../../platform/db/schema';

export type AreaRow = typeof areas.$inferSelect;
export type Area = AreaRow & {
  readonly children?: readonly Area[];
};
export type AreaWithChildren = AreaRow & {
  children?: AreaWithChildren[];
};
