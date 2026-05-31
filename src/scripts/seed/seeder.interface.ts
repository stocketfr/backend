import { type NodePgDatabase } from 'drizzle-orm/node-postgres';

export interface SeedTenant {
  id: string;
  name: string;
  slug: string;
}

export interface SeedContext {
  db: NodePgDatabase;
  tenant: SeedTenant;
  store: Map<string, unknown[]>;
}

export interface Seeder {
  name: string;
  dependencies: string[];
  run(ctx: SeedContext): Promise<void>;
}
