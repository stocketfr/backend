import { faker } from '@faker-js/faker';
import { LocationType } from '@stocket/types/locations';
import { StockMovementReason } from '@stocket/types/stock-movements';
import {
  stockMovements,
  type locations,
  type orders,
  type products,
} from '../../effect/platform/db/schema';
import { MOCK_USER_ID, SEED_CONFIG, withTenant } from './config';
import { registry } from './registry';

registry.register({
  name: 'stock-movements',
  dependencies: ['products', 'locations', 'orders'],
  async run(ctx) {
    console.log('Seeding stock movements...');

    const allProducts = ctx.store.get(
      'products',
    ) as (typeof products.$inferSelect)[];
    const allLocations = ctx.store.get(
      'locations',
    ) as (typeof locations.$inferSelect)[];
    const allOrders = ctx.store.get('orders') as (typeof orders.$inferSelect)[];

    const movements: (typeof stockMovements.$inferSelect)[] = [];
    const warehouseLocations = allLocations.filter(
      (l) => l.type === LocationType.WAREHOUSE,
    );

    for (let i = 0; i < SEED_CONFIG.stockMovements; i++) {
      const product = faker.helpers.arrayElement(allProducts);

      const reason = faker.helpers.weightedArrayElement([
        { value: StockMovementReason.PURCHASE_RECEIVE, weight: 4 },
        { value: StockMovementReason.SALE, weight: 3 },
        { value: StockMovementReason.INTERNAL_TRANSFER, weight: 3 },
        { value: StockMovementReason.WASTE, weight: 1 },
        { value: StockMovementReason.DAMAGED, weight: 1 },
        { value: StockMovementReason.EXPIRED, weight: 1 },
        { value: StockMovementReason.COUNT_CORRECTION, weight: 2 },
        { value: StockMovementReason.RETURN_FROM_CLIENT, weight: 1 },
        { value: StockMovementReason.RETURN_TO_SUPPLIER, weight: 1 },
      ]);

      let fromLocationId: string | null = null;
      let toLocationId: string | null = null;

      switch (reason) {
        case StockMovementReason.PURCHASE_RECEIVE:
          toLocationId = faker.helpers.arrayElement(warehouseLocations).id;
          break;
        case StockMovementReason.SALE:
          fromLocationId = faker.helpers.arrayElement(warehouseLocations).id;
          break;
        case StockMovementReason.INTERNAL_TRANSFER:
          fromLocationId = faker.helpers.arrayElement(allLocations).id;
          toLocationId = faker.helpers.arrayElement(
            allLocations.filter((l) => l.id !== fromLocationId),
          ).id;
          break;
        case StockMovementReason.WASTE:
        case StockMovementReason.DAMAGED:
        case StockMovementReason.EXPIRED:
          fromLocationId = faker.helpers.arrayElement(warehouseLocations).id;
          break;
        case StockMovementReason.COUNT_CORRECTION:
        case StockMovementReason.RETURN_FROM_CLIENT:
          toLocationId = faker.helpers.arrayElement(warehouseLocations).id;
          break;
        case StockMovementReason.RETURN_TO_SUPPLIER:
          fromLocationId = faker.helpers.arrayElement(warehouseLocations).id;
          break;
      }

      const relatedOrder =
        reason === StockMovementReason.SALE
          ? faker.helpers.maybe(() => faker.helpers.arrayElement(allOrders), {
              probability: 0.5,
            })
          : null;

      const [saved] = await ctx.db
        .insert(stockMovements)
        .values(
          withTenant(ctx.tenant, {
            product_id: product.id,
            from_location_id: fromLocationId,
            to_location_id: toLocationId,
            quantity: faker.number.int({ min: 1, max: 100 }),
            reason,
            order_id: relatedOrder?.id ?? null,
            reference_number: faker.helpers.maybe(
              () =>
                `REF-${faker.string.alphanumeric({ length: 8, casing: 'upper' })}`,
              { probability: 0.5 },
            ),
            cost_per_unit: faker.helpers.maybe(
              () =>
                faker.number.float({ min: 1, max: 2000, fractionDigits: 2 }),
              { probability: 0.6 },
            ),
            user_id: MOCK_USER_ID,
            notes: faker.helpers.maybe(
              () =>
                faker.helpers.arrayElement([
                  'Regular stock replenishment',
                  'Damaged during transit',
                  'Expired - disposed per policy',
                  'Physical count adjustment',
                  'Client return - inspected OK',
                  faker.lorem.sentence(),
                ]),
              { probability: 0.3 },
            ),
          }),
        )
        .returning();
      movements.push(saved!);
    }

    console.log(`  Created ${movements.length} stock movements\n`);
    ctx.store.set('stock-movements', movements);
  },
});
