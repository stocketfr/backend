import { faker } from '@faker-js/faker';
import { LocationType } from '@stocket/types/locations';
import {
  inventory,
  type areas,
  type locations,
  type products,
} from '../../effect/platform/db/schema';
import { SEED_CONFIG, withTenant } from './config';
import { buildInventory } from './factories';
import { registry } from './registry';

registry.register({
  name: 'inventory',
  dependencies: ['products', 'locations', 'areas'],
  async run(ctx) {
    console.log('Seeding inventory...');

    const allProducts = ctx.store.get(
      'products',
    ) as (typeof products.$inferSelect)[];
    const allLocations = ctx.store.get(
      'locations',
    ) as (typeof locations.$inferSelect)[];
    const allAreas = ctx.store.get('areas') as (typeof areas.$inferSelect)[];

    const inventoryRecords: (typeof inventory.$inferSelect)[] = [];

    const warehouseLocations = allLocations.filter(
      (l) =>
        l.type === LocationType.WAREHOUSE || l.type === LocationType.SUPPLIER,
    );

    for (let i = 0; i < SEED_CONFIG.inventoryRecords; i++) {
      const product = faker.helpers.arrayElement(allProducts);
      const location = faker.helpers.arrayElement(warehouseLocations);

      const locationAreas = allAreas.filter(
        (a) => a.location_id === location.id,
      );
      const area =
        locationAreas.length > 0
          ? faker.helpers.maybe(
              () => faker.helpers.arrayElement(locationAreas),
              { probability: 0.6 },
            )
          : null;

      const attrs = withTenant(
        ctx.tenant,
        buildInventory(product.id, location.id, {
          areaId: area?.id,
          isPerishable: product.is_perishable,
          standardCost: product.standard_cost,
        }),
      );
      const [saved] = await ctx.db.insert(inventory).values(attrs).returning();
      inventoryRecords.push(saved!);

      if ((i + 1) % 50 === 0) {
        console.log(
          `  ${i + 1}/${SEED_CONFIG.inventoryRecords} inventory records...`,
        );
      }
    }

    console.log(`  Created ${inventoryRecords.length} inventory records\n`);
    ctx.store.set('inventory', inventoryRecords);
  },
});
