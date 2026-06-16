import { Effect, Layer } from 'effect';
import { OrderStatus } from '@stocket/types/orders';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
} from '../../testing/integration-layer';
import { seedCategory, seedProduct, seedClient, TEST_USER_ID } from '../../testing/seed';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { OrdersService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<OrdersService>;

beforeAll(() => {
  db = getTestDb();
  const dbLayer = makeTestDrizzleLayer();
  TestLayer = OrdersService.Default.pipe(Layer.provide(dbLayer));
});

afterAll(() => closeTestDb());
beforeEach(() => truncateAll());

const run = <A, E>(effect: Effect.Effect<A, E, OrdersService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

async function seedOrderPrereqs() {
  const category = await seedCategory(db);
  const product = await seedProduct(db, { category_id: category.id });
  const client = await seedClient(db);
  return { category, product, client };
}

describe('OrdersService Integration', () => {
  describe('create', () => {
    it('creates an order with validated references and correct totals', async () => {
      const { product, client } = await seedOrderPrereqs();

      const result = await run(
        Effect.flatMap(OrdersService, (svc) =>
          svc.create(
            {
              client_id: client.id,
              delivery_address: '42 Quai des Belges, Marseille',
              items: [
                { product_id: product.id, quantity: 3, unit_price: 25 },
              ],
            },
            TEST_USER_ID,
          ),
        ),
      );

      expect(result.client_id).toBe(client.id);
      expect(result.total_amount).toBe(75);
      expect(result.status).toBe(OrderStatus.DRAFT);
      expect(result.order_number).toMatch(/^ORD-\d{8}-0{4}1$/);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        product_id: product.id,
        quantity: 3,
        unit_price: 25,
        subtotal: 75,
      });
    });

    it('creates sequential order numbers', async () => {
      const { product, client } = await seedOrderPrereqs();
      const dto = {
        client_id: client.id,
        delivery_address: 'Test',
        items: [{ product_id: product.id, quantity: 1, unit_price: 10 }],
      };

      const [first, second] = await run(
        Effect.flatMap(OrdersService, (svc) =>
          Effect.all([svc.create(dto, TEST_USER_ID), svc.create(dto, TEST_USER_ID)], {
            concurrency: 1,
          }),
        ),
      );

      expect(first.order_number).toContain('00001');
      expect(second.order_number).toContain('00002');
    });

    it('fails when the client does not exist', async () => {
      const { product } = await seedOrderPrereqs();

      const error = await Effect.runPromise(
        Effect.flip(
          Effect.flatMap(OrdersService, (svc) =>
            svc.create(
              {
                client_id: '00000000-0000-0000-0000-000000000000',
                delivery_address: 'Test',
                items: [
                  { product_id: product.id, quantity: 1, unit_price: 10 },
                ],
              },
              TEST_USER_ID,
            ),
          ).pipe(Effect.provide(TestLayer)),
        ),
      );

      expect(error._tag).toBe('ClientNotFound');
    });

    it('fails when a product does not exist', async () => {
      const { client } = await seedOrderPrereqs();

      const error = await Effect.runPromise(
        Effect.flip(
          Effect.flatMap(OrdersService, (svc) =>
            svc.create(
              {
                client_id: client.id,
                delivery_address: 'Test',
                items: [
                  {
                    product_id: '00000000-0000-0000-0000-000000000000',
                    quantity: 1,
                    unit_price: 10,
                  },
                ],
              },
              TEST_USER_ID,
            ),
          ).pipe(Effect.provide(TestLayer)),
        ),
      );

      expect(error._tag).toBe('ProductNotFound');
    });
  });

  describe('findOne', () => {
    it('returns order with client and item joins populated', async () => {
      const { product, client } = await seedOrderPrereqs();

      const result = await run(
        Effect.flatMap(OrdersService, (svc) =>
          Effect.flatMap(
            svc.create(
              {
                client_id: client.id,
                delivery_address: 'Dock 7',
                items: [
                  { product_id: product.id, quantity: 2, unit_price: 50 },
                ],
              },
              TEST_USER_ID,
            ),
            (created) => svc.findOne(created.id),
          ),
        ),
      );

      expect(result.client_name).toBe(client.company_name);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.product_name).toBe(product.name);
    });

    it('fails for a nonexistent order', async () => {
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.flatMap(OrdersService, (svc) =>
            svc.findOne('00000000-0000-0000-0000-000000000000'),
          ).pipe(Effect.provide(TestLayer)),
        ),
      );

      expect(error._tag).toBe('OrderNotFound');
    });
  });

  describe('updateStatus', () => {
    it('transitions DRAFT → CONFIRMED and sets confirmed_at', async () => {
      const { product, client } = await seedOrderPrereqs();

      const result = await run(
        Effect.flatMap(OrdersService, (svc) =>
          Effect.flatMap(
            svc.create(
              {
                client_id: client.id,
                delivery_address: 'Test',
                items: [
                  { product_id: product.id, quantity: 1, unit_price: 10 },
                ],
              },
              TEST_USER_ID,
            ),
            (order) =>
              svc.updateStatus(order.id, { status: OrderStatus.CONFIRMED }),
          ),
        ),
      );

      expect(result.status).toBe(OrderStatus.CONFIRMED);
      expect(result.confirmed_at).toBeTruthy();
    });

    it('rejects invalid transition DRAFT → PICKING', async () => {
      const { product, client } = await seedOrderPrereqs();

      const error = await Effect.runPromise(
        Effect.flip(
          Effect.flatMap(OrdersService, (svc) =>
            Effect.flatMap(
              svc.create(
                {
                  client_id: client.id,
                  delivery_address: 'Test',
                  items: [
                    { product_id: product.id, quantity: 1, unit_price: 10 },
                  ],
                },
                TEST_USER_ID,
              ),
              (order) =>
                svc.updateStatus(order.id, { status: OrderStatus.PICKING }),
            ),
          ).pipe(Effect.provide(TestLayer)),
        ),
      );

      expect(error._tag).toBe('InvalidOrderStatusTransition');
    });
  });

  describe('delete', () => {
    it('deletes a draft order and its items', async () => {
      const { product, client } = await seedOrderPrereqs();

      const error = await run(
        Effect.flatMap(OrdersService, (svc) =>
          Effect.flatMap(
            svc.create(
              {
                client_id: client.id,
                delivery_address: 'Test',
                items: [
                  { product_id: product.id, quantity: 1, unit_price: 10 },
                ],
              },
              TEST_USER_ID,
            ),
            (order) =>
              Effect.flatMap(svc.delete(order.id), () =>
                Effect.flip(svc.findOne(order.id)),
            ),
          ),
        ),
      );

      expect(error._tag).toBe('OrderNotFound');
    });

    it('rejects deleting a confirmed order', async () => {
      const { product, client } = await seedOrderPrereqs();

      const error = await Effect.runPromise(
        Effect.flip(
          Effect.flatMap(OrdersService, (svc) =>
            Effect.flatMap(
              svc.create(
                {
                  client_id: client.id,
                  delivery_address: 'Test',
                  items: [
                    { product_id: product.id, quantity: 1, unit_price: 10 },
                  ],
                },
                TEST_USER_ID,
              ),
              (order) =>
                Effect.flatMap(
                  svc.updateStatus(order.id, {
                    status: OrderStatus.CONFIRMED,
                  }),
                  () => svc.delete(order.id),
                ),
            ),
          ).pipe(Effect.provide(TestLayer)),
        ),
      );

      expect(error._tag).toBe('CannotDeleteNonDraftOrder');
    });
  });

  describe('findAllPaginated', () => {
    it('returns paginated results with correct metadata', async () => {
      const { product, client } = await seedOrderPrereqs();
      const dto = {
        client_id: client.id,
        delivery_address: 'Test',
        items: [{ product_id: product.id, quantity: 1, unit_price: 10 }],
      };

      const result = await run(
        Effect.flatMap(OrdersService, (svc) =>
          Effect.flatMap(
            Effect.all(
              [svc.create(dto, TEST_USER_ID), svc.create(dto, TEST_USER_ID), svc.create(dto, TEST_USER_ID)],
              { concurrency: 1 },
            ),
            () => svc.findAllPaginated({ page: 1, limit: 2 }),
          ),
        ),
      );

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(3);
      expect(result.meta.total_pages).toBe(2);
    });
  });
});
