import type { categories } from '../../platform/db/schema';

export type Category = typeof categories.$inferSelect;
