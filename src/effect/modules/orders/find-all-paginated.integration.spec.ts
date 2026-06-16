import { Effect, Layer } from 'effect';
import { OrderStatus } from '@stocket/types/orders';
import type { DrizzleDb } from '../../platform/db/drizzle';
import {
  getTestDb,
  makeTestDrizzleLayer,
  runTest,
  seedCategory,
  seedClient,
  seedOrder,
  seedOrderItems,
  seedProduct,
  TEST_USER_ID,
  withTestDb,
} from '../../testing/test-harness';
import { OrdersService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<OrdersService>;

withTestDb();
beforeAll(() => {
  db = getTestDb();
  TestLayer = OrdersService.Default.pipe(Layer.provide(makeTestDrizzleLayer()));
});

const listOrders = (query: Record<string, unknown>) =>
  runTest(
    Effect.flatMap(OrdersService, (svc) =>
      svc.findAllPaginated({ page: 1, limit: 20, ...query } as never),
    ),
    TestLayer,
  );

async function seedOrderMatrixPrereqs() {
  const category = await seedCategory(db);
  const productA = await seedProduct(db, {
    category_id: category.id,
    sku: 'ORDER-MATRIX-A',
    name: 'Order Matrix A',
  });
  const productB = await seedProduct(db, {
    category_id: category.id,
    sku: 'ORDER-MATRIX-B',
    name: 'Order Matrix B',
  });
  const clientA = await seedClient(db, { company_name: 'Acme Yachts' });
  const clientB = await seedClient(db, { company_name: 'Beta Charters' });
  return { productA, productB, clientA, clientB };
}

describe('OrdersService findAllPaginated filter matrix', () => {
  it('combines q, client, status, and date filters without duplicate counts from items', async () => {
    const { productA, productB, clientA, clientB } =
      await seedOrderMatrixPrereqs();
    const target = await seedOrder(db, {
      client_id: clientA.id,
      created_by: TEST_USER_ID,
      order_number: 'ORD-ACME-TARGET',
      status: OrderStatus.CONFIRMED,
      total_amount: 30,
      created_at: new Date('2026-05-10T08:00:00.000Z'),
    });
    await seedOrderItems(db, [
      {
        order_id: target.id,
        product_id: productA.id,
        quantity: 1,
        unit_price: 10,
        subtotal: 10,
      },
      {
        order_id: target.id,
        product_id: productB.id,
        quantity: 1,
        unit_price: 20,
        subtotal: 20,
      },
    ]);
    await seedOrder(db, {
      client_id: clientA.id,
      created_by: TEST_USER_ID,
      order_number: 'ORD-ACME-DRAFT',
      status: OrderStatus.DRAFT,
      total_amount: 10,
      created_at: new Date('2026-05-10T08:00:00.000Z'),
    });
    await seedOrder(db, {
      client_id: clientB.id,
      created_by: TEST_USER_ID,
      order_number: 'ORD-BETA-TARGET',
      status: OrderStatus.CONFIRMED,
      total_amount: 10,
      created_at: new Date('2026-05-10T08:00:00.000Z'),
    });
    await seedOrder(db, {
      client_id: clientA.id,
      created_by: TEST_USER_ID,
      order_number: 'ORD-ACME-OLD',
      status: OrderStatus.CONFIRMED,
      total_amount: 10,
      created_at: new Date('2026-04-01T08:00:00.000Z'),
    });

    const result = await listOrders({
      q: 'Acme',
      client_id: clientA.id,
      status: OrderStatus.CONFIRMED,
      date_from: new Date('2026-05-01T00:00:00.000Z'),
      date_to: new Date('2026-05-31T23:59:59.000Z'),
    });

    expect(result.meta.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: target.id,
      order_number: 'ORD-ACME-TARGET',
      client_name: 'Acme Yachts',
      status: OrderStatus.CONFIRMED,
    });
    expect(result.data[0]?.items).toHaveLength(2);
  });

  it('searches by order number and returns created-at descending pages', async () => {
    const { clientA } = await seedOrderMatrixPrereqs();
    const oldest = await seedOrder(db, {
      client_id: clientA.id,
      created_by: TEST_USER_ID,
      order_number: 'ORD-SEARCH-OLD',
      total_amount: 10,
      created_at: new Date('2026-05-01T08:00:00.000Z'),
    });
    const middle = await seedOrder(db, {
      client_id: clientA.id,
      created_by: TEST_USER_ID,
      order_number: 'ORD-SEARCH-MIDDLE',
      total_amount: 10,
      created_at: new Date('2026-05-02T08:00:00.000Z'),
    });
    const newest = await seedOrder(db, {
      client_id: clientA.id,
      created_by: TEST_USER_ID,
      order_number: 'ORD-SEARCH-NEW',
      total_amount: 10,
      created_at: new Date('2026-05-03T08:00:00.000Z'),
    });

    const firstPage = await listOrders({
      q: 'ORD-SEARCH',
      page: 1,
      limit: 2,
    });

    expect(firstPage.meta).toMatchObject({
      total: 3,
      page: 1,
      limit: 2,
      total_pages: 2,
    });
    expect(firstPage.data.map((order) => order.id)).toEqual([
      newest.id,
      middle.id,
    ]);

    const secondPage = await listOrders({
      q: 'ORD-SEARCH',
      page: 2,
      limit: 2,
    });
    expect(secondPage.data.map((order) => order.id)).toEqual([oldest.id]);
  });
});
