import { faker } from '@faker-js/faker';
import { LocationType } from '@stocket/types/locations';
import { areas, locations } from '../../effect/platform/db/schema';
import {
  AREA_TEMPLATES,
  LOCATION_NAMES,
  SEED_CONFIG,
  SUB_AREA_TEMPLATES,
  withTenant,
} from './config';
import { buildLocation } from './factories';
import { registry } from './registry';

registry.register({
  name: 'locations',
  dependencies: [],
  async run(ctx) {
    console.log('Seeding locations...');

    const allLocations: (typeof locations.$inferSelect)[] = [];

    for (const loc of LOCATION_NAMES.slice(0, SEED_CONFIG.locations)) {
      const [saved] = await ctx.db
        .insert(locations)
        .values(withTenant(ctx.tenant, buildLocation(loc.name, loc.type)))
        .returning();
      allLocations.push(saved!);
    }

    console.log(`  Created ${allLocations.length} locations\n`);
    ctx.store.set('locations', allLocations);
  },
});

registry.register({
  name: 'areas',
  dependencies: ['locations'],
  async run(ctx) {
    console.log('Seeding areas...');

    const allLocations = ctx.store.get(
      'locations',
    ) as (typeof locations.$inferSelect)[];

    const allAreas: (typeof areas.$inferSelect)[] = [];
    const warehouseLocations = allLocations.filter(
      (l) => l.type === LocationType.WAREHOUSE,
    );

    for (const location of warehouseLocations) {
      const templateKey = location.name.toLowerCase().includes('cold')
        ? 'cold_storage'
        : location.name.toLowerCase().includes('workshop') ||
            location.name.toLowerCase().includes('electronics')
          ? 'workshop'
          : 'warehouse';

      const areaNames = (
        AREA_TEMPLATES[templateKey] ??
        AREA_TEMPLATES.warehouse ??
        []
      ).slice(0, SEED_CONFIG.areasPerLocation);

      let areaCode = 1;

      for (const areaName of areaNames) {
        const [savedArea] = await ctx.db
          .insert(areas)
          .values(
            withTenant(ctx.tenant, {
              location_id: location.id,
              parent_id: null,
              name: areaName,
              code: `${location.name.charAt(0).toUpperCase()}${areaCode}`,
              description: `${areaName} in ${location.name}`,
              is_active: true,
            }),
          )
          .returning();
        allAreas.push(savedArea!);
        areaCode++;

        const subAreaCount = faker.number.int({
          min: 0,
          max: SEED_CONFIG.subAreasPerArea,
        });
        for (let j = 0; j < subAreaCount; j++) {
          const [savedSub] = await ctx.db
            .insert(areas)
            .values(
              withTenant(ctx.tenant, {
                location_id: location.id,
                parent_id: savedArea!.id,
                name: SUB_AREA_TEMPLATES[j % SUB_AREA_TEMPLATES.length]!,
                code: `${savedArea!.code}-${j + 1}`,
                description: '',
                is_active: true,
              }),
            )
            .returning();
          allAreas.push(savedSub!);
        }
      }
    }

    console.log(`  Created ${allAreas.length} areas\n`);
    ctx.store.set('areas', allAreas);
  },
});
