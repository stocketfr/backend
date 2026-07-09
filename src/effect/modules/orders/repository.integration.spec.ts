import { Effect, Layer } from 'effect';
import { eq } from 'drizzle-orm';
import { OrderStatus } from '@stocket/types/orders';
import {
  closeTestDb,
  getTestDb,
  makeTestDrizzleLayer,
  truncateAll,
} from '../../testing/integration-layer';
import {
  seedCategory,
  seedClient,
  seedOrder,
  seedOrderItems,
  seedProduct,
  TEST_USER_ID,
} from '../../testing/seed';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { orderItems, orders } from '../../platform/db/schema';
import { OrdersRepository } from './repository';

let db: DrizzleDb;
let TestLayer: Layer.Layer<OrdersRepository>;

beforeAll(() => {
  db = getTestDb();
  TestLayer = OrdersRepository.Default.pipe(
    Layer.provide(makeTestDrizzleLayer()),
  );
});

afterAll(() => closeTestDb());
beforeEach(() => truncateAll());

const run = <A, E>(effect: Effect.Effect<A, E, OrdersRepository>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const fail = <A, E>(effect: Effect.Effect<A, E, OrdersRepository>) =>
  Effect.runPromise(Effect.flip(effect.pipe(Effect.provide(TestLayer))));

async function seedOrderPrereqs() {
  const category = await seedCategory(db);
  const product = await seedProduct(db, { category_id: category.id });
  const client = await seedClient(db);
  return { product, client };
}

const findOrderItems = (orderId: string) =>
  db.select().from(orderItems).where(eq(orderItems.order_id, orderId));

describe('OrdersRepository transactions', () => {
  it('rolls back the order row when item creation fails', async () => {
    const { client } = await seedOrderPrereqs();

    const error = await fail(
      Effect.flatMap(OrdersRepository, (repository) =>
        repository.createWithItems(
          {
            client_id: client.id,
            created_by: TEST_USER_ID,
            delivery_address: 'Rollback Dock',
            order_number: 'ORD-TX-ROLLBACK',
            status: OrderStatus.DRAFT,
            total_amount: 10,
          },
          [
            {
              product_id: '00000000-0000-0000-0000-000000000000',
              quantity: 1,
              unit_price: 10,
              subtotal: 10,
              notes: null,
            },
          ],
        ),
      ),
    );

    expect(error._tag).toBe('OrdersInfrastructureError');

    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.order_number, 'ORD-TX-ROLLBACK'));
    expect(rows).toHaveLength(0);
  });

  it('deletes a draft order and its items atomically', async () => {
    const { product, client } = await seedOrderPrereqs();
    const order = await seedOrder(db, {
      client_id: client.id,
      created_by: TEST_USER_ID,
      status: OrderStatus.DRAFT,
    });
    await seedOrderItems(db, [
      {
        order_id: order.id,
        product_id: product.id,
        quantity: 1,
        unit_price: 10,
        subtotal: 10,
      },
    ]);

    const result = await run(
      Effect.flatMap(OrdersRepository, (repository) =>
        repository.deleteDraftWithItems(order.id),
      ),
    );

    expect(result).toBe('deleted');
    expect(
      await db.select().from(orders).where(eq(orders.id, order.id)),
    ).toHaveLength(0);
    expect(await findOrderItems(order.id)).toHaveLength(0);
  });

  it('does not delete items for a non-draft order', async () => {
    const { product, client } = await seedOrderPrereqs();
    const order = await seedOrder(db, {
      client_id: client.id,
      created_by: TEST_USER_ID,
      status: OrderStatus.CONFIRMED,
    });
    await seedOrderItems(db, [
      {
        order_id: order.id,
        product_id: product.id,
        quantity: 1,
        unit_price: 10,
        subtotal: 10,
      },
    ]);

    const result = await run(
      Effect.flatMap(OrdersRepository, (repository) =>
        repository.deleteDraftWithItems(order.id),
      ),
    );

    expect(result).toBe('not_draft');
    expect(
      await db.select().from(orders).where(eq(orders.id, order.id)),
    ).toHaveLength(1);
    expect(await findOrderItems(order.id)).toHaveLength(1);
  });
});
