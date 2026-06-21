import { defineConfig } from 'drizzle-kit';
import { getDatabaseUrl } from './src/config/db-connection.utils';

export default defineConfig({
  schema: [
    './src/effect/platform/db/schema.ts',
    './src/effect/platform/db/relations.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: getDatabaseUrl(),
  },
});
