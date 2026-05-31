import { faker } from '@faker-js/faker';
import { ClientStatus } from '@stocket/types/clients';
import { OrderStatus } from '@stocket/types/orders';
import { eq } from 'drizzle-orm';
import {
  orders,
  orderItems,
  type clients,
  type products,
} from '../../effect/platform/db/schema';
import { MOCK_USER_ID, SEED_CONFIG, withTenant } from './config';
import { registry } from './registry';

registry.register({
  name: 'orders',
  dependencies: ['clients', 'products'],
  async run(ctx) {
    console.log('Seeding orders...');

    const allClients = ctx.store.get(
      'clients',
    ) as (typeof clients.$inferSelect)[];
    const allProducts = ctx.store.get(
      'products',
    ) as (typeof products.$inferSelect)[];

    const allOrders: (typeof orders.$inferSelect)[] = [];
    const allOrderItems: (typeof orderItems.$inferSelect)[] = [];

    const activeClients = allClients.filter(
      (c) => c.account_status === ClientStatus.ACTIVE,
    );

    for (let i = 0; i < SEED_CONFIG.orders; i++) {
      const client = faker.helpers.arrayElement(activeClients);
      const orderDate = faker.date.recent({ days: 60 });

      const status = faker.helpers.weightedArrayElement([
        { value: OrderStatus.DRAFT, weight: 2 },
        { value: OrderStatus.CONFIRMED, weight: 3 },
        { value: OrderStatus.SOURCING, weight: 2 },
        { value: OrderStatus.PICKING, weight: 2 },
        { value: OrderStatus.PACKED, weight: 2 },
        { value: OrderStatus.SHIPPED, weight: 3 },
        { value: OrderStatus.DELIVERED, weight: 4 },
        { value: OrderStatus.CANCELLED, weight: 1 },
        { value: OrderStatus.ON_HOLD, weight: 1 },
      ]);

      const confirmedAt =
        status !== OrderStatus.DRAFT && status !== OrderStatus.CANCELLED
          ? new Date(
              orderDate.getTime() +
                faker.number.int({ min: 3600000, max: 86400000 }),
            )
          : null;
      const shippedAt =
        status === OrderStatus.SHIPPED || status === OrderStatus.DELIVERED
          ? new Date(
              (confirmedAt ?? orderDate).getTime() +
                faker.number.int({ min: 86400000, max: 604800000 }),
            )
          : null;
      const deliveredAt =
        status === OrderStatus.DELIVERED && shippedAt
          ? new Date(
              shippedAt.getTime() +
                faker.number.int({ min: 3600000, max: 259200000 }),
            )
          : null;

      const orderNumber = `ORD-${(orderDate.getFullYear() % 100).toString().padStart(2, '0')}${(orderDate.getMonth() + 1).toString().padStart(2, '0')}-${String(i + 1).padStart(4, '0')}`;

      const [savedOrder] = await ctx.db
        .insert(orders)
        .values(
          withTenant(ctx.tenant, {
            order_number: orderNumber,
            client_id: client.id,
            status,
            delivery_deadline: faker.helpers.maybe(
              () => faker.date.soon({ days: 14, refDate: orderDate }),
              { probability: 0.7 },
            ),
            delivery_address:
              client.default_delivery_address ??
              `Marina Berth ${faker.number.int({ min: 1, max: 200 })}, ${faker.location.city()}`,
            yacht_name: client.yacht_name,
            special_instructions: faker.helpers.maybe(
              () =>
                faker.helpers.arrayElement([
                  'Deliver before 10 AM',
                  'Contact captain before delivery',
                  'Fragile items - handle with care',
                  'Refrigerated items - keep cold chain',
                  'Leave at dock security if no one aboard',
                  faker.lorem.sentence(),
                ]),
              { probability: 0.4 },
            ),
            total_amount: 0,
            assigned_to: faker.helpers.maybe(() => MOCK_USER_ID, {
              probability: 0.6,
            }),
            created_by: MOCK_USER_ID,
            confirmed_at: confirmedAt,
            shipped_at: shippedAt,
            delivered_at: deliveredAt,
          }),
        )
        .returning();

      const itemCount = faker.number.int({
        min: SEED_CONFIG.itemsPerOrder.min,
        max: SEED_CONFIG.itemsPerOrder.max,
      });
      let totalAmount = 0;
      const usedProductIds = new Set<string>();

      for (let j = 0; j < itemCount; j++) {
        let product: (typeof allProducts)[number];
        let attempts = 0;
        do {
          product = faker.helpers.arrayElement(allProducts);
          attempts++;
        } while (usedProductIds.has(product.id) && attempts < 20);

        if (usedProductIds.has(product.id)) continue;
        usedProductIds.add(product.id);

        const quantity = faker.number.int({ min: 1, max: 20 });
        const unitPrice = product.standard_price ?? product.standard_cost ?? 50;
        const subtotal = Number.parseFloat((quantity * unitPrice).toFixed(2));
        totalAmount += subtotal;

        let quantityPicked = 0;
        let quantityPacked = 0;
        if (
          [
            OrderStatus.PICKING,
            OrderStatus.PACKED,
            OrderStatus.SHIPPED,
            OrderStatus.DELIVERED,
          ].includes(status)
        ) {
          quantityPicked =
            status === OrderStatus.PICKING
              ? faker.number.int({ min: 0, max: quantity })
              : quantity;
        }
        if (
          [
            OrderStatus.PACKED,
            OrderStatus.SHIPPED,
            OrderStatus.DELIVERED,
          ].includes(status)
        ) {
          quantityPacked = quantity;
        }

        const [savedItem] = await ctx.db
          .insert(orderItems)
          .values({
            order_id: savedOrder!.id,
            product_id: product.id,
            quantity,
            unit_price: unitPrice,
            subtotal,
            notes: faker.helpers.maybe(() => faker.lorem.sentence(), {
              probability: 0.2,
            }),
            quantity_picked: quantityPicked,
            quantity_packed: quantityPacked,
          })
          .returning();
        allOrderItems.push(savedItem!);
      }

      await ctx.db
        .update(orders)
        .set({
          total_amount: Number.parseFloat(totalAmount.toFixed(2)),
        })
        .where(eq(orders.id, savedOrder!.id));

      savedOrder!.total_amount = Number.parseFloat(totalAmount.toFixed(2));
      allOrders.push(savedOrder!);
    }

    console.log(
      `  Created ${allOrders.length} orders with ${allOrderItems.length} line items\n`,
    );
    ctx.store.set('orders', allOrders);
    ctx.store.set('order-items', allOrderItems);
  },
});
