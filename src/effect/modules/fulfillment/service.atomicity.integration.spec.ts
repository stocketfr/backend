import { Effect, Layer } from 'effect';
import { eq, sql } from 'drizzle-orm';
import { OrderStatus } from '@stocket/types/orders';
import {
  inventory,
  orderItems,
  orders,
  stockMovements,
} from '../../platform/db/schema';
import type { DrizzleDb } from '../../platform/db/drizzle';
import {
  getTestDb,
  makeTestDrizzleLayer,
  runTest,
  runTestFailure,
  seedCategory,
  seedClient,
  seedInventory,
  seedLocation,
  seedOrder,
  seedOrderItems,
  seedProduct,
  TEST_USER_ID,
  TEST_USER_ID_2,
  withTestDb,
} from '../../testing/test-harness';
import { FulfillmentService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<FulfillmentService>;

withTestDb();
beforeAll(() => {
  db = getTestDb();
  TestLayer = FulfillmentService.Default.pipe(
    Layer.provide(makeTestDrizzleLayer()),
  );
});

async function seedConfirmedPickScenario(
  overrides: { inventoryQuantity?: number } = {},
) {
  const category = await seedCategory(db);
  const product = await seedProduct(db, { category_id: category.id });
  const location = await seedLocation(db);
  const client = await seedClient(db);
  const order = await seedOrder(db, {
    client_id: client.id,
    created_by: TEST_USER_ID,
    status: OrderStatus.DRAFT,
    total_amount: 50,
  });
  const [orderItem] = await seedOrderItems(db, [
    {
      order_id: order.id,
      product_id: product.id,
      quantity: 5,
      unit_price: 10,
      subtotal: 50,
    },
  ]);
  const inv = await seedInventory(db, {
    product_id: product.id,
    location_id: location.id,
    quantity: overrides.inventoryQuantity ?? 100,
  });

  await runTest(
    Effect.flatMap(FulfillmentService, (svc) =>
      svc.confirm(order.id, TEST_USER_ID_2),
    ),
    TestLayer,
  );

  return { product, order, orderItem: orderItem!, inv };
}

async function loadPickState(
  orderId: string,
  orderItemId: string,
  inventoryId: string,
) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  const [item] = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.id, orderItemId));
  const [inv] = await db
    .select()
    .from(inventory)
    .where(eq(inventory.id, inventoryId));
  const movements = await db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.order_id, orderId));

  if (!order || !item || !inv) {
    throw new Error('Missing seeded fulfillment state');
  }

  return {
    orderStatus: order.status,
    quantityPicked: item.quantity_picked,
    inventoryQuantity: inv.quantity,
    movementCount: movements.length,
  };
}

describe('FulfillmentService pick atomicity', () => {
  it('rolls back the transition when a picked order item does not exist', async () => {
    const { order, orderItem, inv } = await seedConfirmedPickScenario();

    const error = await runTestFailure(
      Effect.flatMap(FulfillmentService, (svc) =>
        svc.pick({
          orderId: order.id,
          actorId: TEST_USER_ID_2,
          picks: [
            {
              orderItemId: '00000000-0000-4000-b000-000000000999',
              inventoryId: inv.id,
              quantity: 1,
            },
          ],
        }),
      ),
      TestLayer,
    );

    expect(error._tag).toBe('FulfillmentPickFailed');
    await expect(
      loadPickState(order.id, orderItem.id, inv.id),
    ).resolves.toEqual({
      orderStatus: OrderStatus.CONFIRMED,
      quantityPicked: 0,
      inventoryQuantity: 100,
      movementCount: 0,
    });
  });

  it('rolls back the transition when inventory is insufficient', async () => {
    const { order, orderItem, inv } = await seedConfirmedPickScenario({
      inventoryQuantity: 2,
    });

    const error = await runTestFailure(
      Effect.flatMap(FulfillmentService, (svc) =>
        svc.pick({
          orderId: order.id,
          actorId: TEST_USER_ID_2,
          picks: [
            { orderItemId: orderItem.id, inventoryId: inv.id, quantity: 3 },
          ],
        }),
      ),
      TestLayer,
    );

    expect(error._tag).toBe('FulfillmentPickFailed');
    await expect(
      loadPickState(order.id, orderItem.id, inv.id),
    ).resolves.toEqual({
      orderStatus: OrderStatus.CONFIRMED,
      quantityPicked: 0,
      inventoryQuantity: 2,
      movementCount: 0,
    });
  });

  it('rolls back inventory decrement when the pick would over-pick', async () => {
    const { order, orderItem, inv } = await seedConfirmedPickScenario();

    const error = await runTestFailure(
      Effect.flatMap(FulfillmentService, (svc) =>
        svc.pick({
          orderId: order.id,
          actorId: TEST_USER_ID_2,
          picks: [
            { orderItemId: orderItem.id, inventoryId: inv.id, quantity: 6 },
          ],
        }),
      ),
      TestLayer,
    );

    expect(error._tag).toBe('FulfillmentPickFailed');
    await expect(
      loadPickState(order.id, orderItem.id, inv.id),
    ).resolves.toEqual({
      orderStatus: OrderStatus.CONFIRMED,
      quantityPicked: 0,
      inventoryQuantity: 100,
      movementCount: 0,
    });
  });

  it('rolls back all writes when stock movement persistence fails', async () => {
    const { order, orderItem, inv } = await seedConfirmedPickScenario();

    const error = await runTestFailure(
      Effect.flatMap(FulfillmentService, (svc) =>
        svc.pick({
          orderId: order.id,
          actorId: 'not-a-uuid',
          picks: [
            { orderItemId: orderItem.id, inventoryId: inv.id, quantity: 2 },
          ],
        }),
      ),
      TestLayer,
    );

    expect(error._tag).toBe('FulfillmentInfrastructureError');
    await expect(
      loadPickState(order.id, orderItem.id, inv.id),
    ).resolves.toEqual({
      orderStatus: OrderStatus.CONFIRMED,
      quantityPicked: 0,
      inventoryQuantity: 100,
      movementCount: 0,
    });

    const countResult = await db.execute(
      sql`SELECT count(*)::int AS count FROM stock_movements`,
    );
    const rows = (countResult as unknown as { rows: { count: number }[] }).rows;
    expect(rows[0]?.count).toBe(0);
  });
});
