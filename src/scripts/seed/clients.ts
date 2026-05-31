import { clients } from '../../effect/platform/db/schema';
import { SEED_CONFIG, withTenant } from './config';
import { buildClient } from './factories';
import { registry } from './registry';

registry.register({
  name: 'clients',
  dependencies: [],
  async run(ctx) {
    console.log('Seeding clients...');

    const allClients: (typeof clients.$inferSelect)[] = [];

    for (let i = 0; i < SEED_CONFIG.clients; i++) {
      const [saved] = await ctx.db
        .insert(clients)
        .values(withTenant(ctx.tenant, buildClient(i)))
        .returning();
      allClients.push(saved!);
    }

    console.log(`  Created ${allClients.length} clients\n`);
    ctx.store.set('clients', allClients);
  },
});
