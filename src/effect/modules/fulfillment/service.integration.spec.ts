import { Effect, Layer } from 'effect';
import { OrderStatus } from '@stocket/types/orders';
import { sql } from 'drizzle-orm';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
} from '../../testing/integration-layer';
import { testPlatformLayer } from '../../testing/test-harness';
import {
  seedCategory,
  seedProduct,
  seedLocation,
  seedClient,
  seedOrder,
  seedOrderItems,
  seedInventory,
  TEST_USER_ID,
  TEST_USER_ID_2,
} from '../../testing/seed';
import { stockMovements } from '../../platform/db/schema';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { FulfillmentService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<FulfillmentService>;

beforeAll(() => {
  db = getTestDb();
  TestLayer = FulfillmentService.Default.pipe(Layer.provide(testPlatformLayer));
});

afterAll(() => closeTestDb());
beforeEach(() => truncateAll());

const run = <A, E>(effect: Effect.Effect<A, E, FulfillmentService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const fail = <A, E>(effect: Effect.Effect<A, E, FulfillmentService>) =>
  Effect.runPromise(Effect.flip(effect.pipe(Effect.provide(TestLayer))));

async function seedFulfillmentScenario() {
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
    quantity: 100,
  });

  return { category, product, location, client, order, orderItem: orderItem!, inv };
}

describe('FulfillmentService Integration', () => {
  describe('confirm', () => {
    it('confirms a draft order and returns the fulfillment view', async () => {
      const { order, orderItem } = await seedFulfillmentScenario();

      const result = await run(
        Effect.flatMap(FulfillmentService, (svc) =>
          svc.confirm(order.id, TEST_USER_ID_2),
        ),
      );

      expect(result.orderId).toBe(order.id);
      expect(result.status).toBe(OrderStatus.CONFIRMED);
      expect(result.confirmedAt).toBeTruthy();
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        orderItemId: orderItem.id,
        quantity: 5,
        quantityPicked: 0,
        quantityPacked: 0,
      });
    });

    it('rejects confirming an already confirmed order', async () => {
      const { order } = await seedFulfillmentScenario();

      const error = await fail(
        Effect.flatMap(FulfillmentService, (svc) =>
          Effect.flatMap(svc.confirm(order.id, TEST_USER_ID_2), () =>
            svc.confirm(order.id, TEST_USER_ID_2),
          ),
        ),
      );

      expect(error._tag).toBe('FulfillmentInvalidTransition');
    });

    it('fails for a nonexistent order', async () => {
      const error = await fail(
        Effect.flatMap(FulfillmentService, (svc) =>
          svc.confirm('00000000-0000-0000-0000-000000000000', TEST_USER_ID),
        ),
      );

      expect(error._tag).toBe('FulfillmentOrderNotFound');
    });
  });

  describe('pick', () => {
    it('decrements inventory, increments picked, and creates stock movement', async () => {
      const { order, orderItem, inv, product } =
        await seedFulfillmentScenario();

      // First confirm the order (picks require CONFIRMED or PICKING status)
      await run(
        Effect.flatMap(FulfillmentService, (svc) =>
          svc.confirm(order.id, TEST_USER_ID_2),
        ),
      );

      const result = await run(
        Effect.flatMap(FulfillmentService, (svc) =>
          svc.pick({
            orderId: order.id,
            actorId: TEST_USER_ID_2,
            picks: [
              {
                orderItemId: orderItem.id,
                inventoryId: inv.id,
                quantity: 3,
              },
            ],
          }),
        ),
      );

      // Fulfillment view should reflect picked quantities
      expect(result.status).toBe(OrderStatus.PICKING);
      expect(result.items[0]!.quantityPicked).toBe(3);

      // Verify inventory was actually decremented in DB
      const invResult = await db.execute(
        sql`SELECT quantity FROM inventory WHERE id = ${inv.id}`,
      );
      const invRow = (invResult as any).rows?.[0] ?? (invResult as any)[0];
      expect(invRow.quantity).toBe(97);

      // Verify stock movement was recorded
      const movements = await db
        .select()
        .from(stockMovements)
        .where(sql`${stockMovements.order_id} = ${order.id}`);
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        product_id: product.id,
        quantity: 3,
        reason: 'SALE',
      });
    });

    it('allows multiple partial picks on the same item', async () => {
      const { order, orderItem, inv } = await seedFulfillmentScenario();

      await run(
        Effect.flatMap(FulfillmentService, (svc) =>
          svc.confirm(order.id, TEST_USER_ID_2),
        ),
      );

      // Pick 2 then pick 2 more (total 4 of 5)
      const result = await run(
        Effect.flatMap(FulfillmentService, (svc) =>
          Effect.flatMap(
            svc.pick({
              orderId: order.id,
              actorId: TEST_USER_ID_2,
              picks: [
                {
                  orderItemId: orderItem.id,
                  inventoryId: inv.id,
                  quantity: 2,
                },
              ],
            }),
            () =>
              svc.pick({
                orderId: order.id,
                actorId: TEST_USER_ID_2,
                picks: [
                  {
                    orderItemId: orderItem.id,
                    inventoryId: inv.id,
                    quantity: 2,
                  },
                ],
              }),
          ),
        ),
      );

      expect(result.items[0]!.quantityPicked).toBe(4);
    });

    it('rejects over-picking beyond ordered quantity', async () => {
      const { order, orderItem, inv } = await seedFulfillmentScenario();

      await run(
        Effect.flatMap(FulfillmentService, (svc) =>
          svc.confirm(order.id, TEST_USER_ID_2),
        ),
      );

      // Try to pick 6 when only 5 were ordered
      const error = await fail(
        Effect.flatMap(FulfillmentService, (svc) =>
          svc.pick({
            orderId: order.id,
            actorId: TEST_USER_ID_2,
            picks: [
              {
                orderItemId: orderItem.id,
                inventoryId: inv.id,
                quantity: 6,
              },
            ],
          }),
        ),
      );

      expect(error._tag).toBe('FulfillmentPickFailed');
    });

    it('rejects picking a draft order', async () => {
      const { order, orderItem, inv } = await seedFulfillmentScenario();

      const error = await fail(
        Effect.flatMap(FulfillmentService, (svc) =>
          svc.pick({
            orderId: order.id,
            actorId: TEST_USER_ID_2,
            picks: [
              {
                orderItemId: orderItem.id,
                inventoryId: inv.id,
                quantity: 1,
              },
            ],
          }),
        ),
      );

      expect(error._tag).toBe('FulfillmentInvalidTransition');
    });
  });

  describe('full workflow: create → confirm → pick', () => {
    it('completes the happy path end-to-end', async () => {
      const { order, orderItem, inv } = await seedFulfillmentScenario();

      await run(
        Effect.flatMap(FulfillmentService, (svc) =>
          Effect.gen(function* () {
            // Confirm
            const confirmed = yield* svc.confirm(order.id, TEST_USER_ID_2);
            expect(confirmed.status).toBe(OrderStatus.CONFIRMED);

            // Pick all items
            const picked = yield* svc.pick({
              orderId: order.id,
              actorId: TEST_USER_ID_2,
              picks: [
                {
                  orderItemId: orderItem.id,
                  inventoryId: inv.id,
                  quantity: 5,
                },
              ],
            });

            expect(picked.status).toBe(OrderStatus.PICKING);
            expect(picked.items[0]!.quantityPicked).toBe(5);
            return picked;
          }),
        ),
      );

      // Verify final inventory state
      const invResult = await db.execute(
        sql`SELECT quantity FROM inventory WHERE id = ${inv.id}`,
      );
      const invRow = (invResult as any).rows?.[0] ?? (invResult as any)[0];
      expect(invRow.quantity).toBe(95);
    });
  });
});
