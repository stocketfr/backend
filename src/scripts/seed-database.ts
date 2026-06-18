import {
  createDatabase,
  readSeedOptions,
  resolveSeedTenant,
  seedUsage,
} from './seed/config';
import { seedTenantData } from './seed/run';

async function main() {
  const options = readSeedOptions();
  if (options.help) {
    console.log(seedUsage);
    return;
  }

  console.log('Starting database seed...\n');

  const db = await createDatabase();
  console.log('Database connected\n');

  try {
    const tenant = await resolveSeedTenant(db, options);
    console.log(`Seeding tenant ${tenant.slug} (${tenant.id})\n`);

    await seedTenantData({
      db,
      tenant,
      store: new Map(),
    });

    console.log('Database seeding completed!\n');
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  } finally {
    const pool = (db as any)._.session?.client;
    if (pool?.end) {
      await pool.end();
      console.log('Database connection closed');
    }
  }
}

void main();
