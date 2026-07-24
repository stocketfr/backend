import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { OrderStatus } from '@stocket/types/orders';
import { makeOrderWriteWorkflows, type OrderWriteRepository } from './write';
import type { CreateOrderDto, UpdateOrderDto } from './types';
import type { OrdersRepository } from './repository';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const ORDER_ID = '10000000-0000-4000-8000-000000000001';
const CLIENT_ID = '20000000-0000-4000-8000-000000000001';
const PRODUCT_ID = '30000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-03-10T10:00:00.000Z');

type CreateOrderData = Parameters<OrderWriteRepository['createWithItems']>[0];
type CreateOrderItems = Parameters<OrderWriteRepository['createWithItems']>[1];
type UpdateOrderData = Parameters<OrderWriteRepository['update']>[1];
type TransitionOrderData = Parameters<
  OrderWriteRepository['transitionStatus']
>[2];
type OrderEntity = NonNullable<
  Effect.Effect.Success<ReturnType<OrdersRepository['findByIdWithRelations']>>
>;

const createDto: CreateOrderDto = {
  client_id: CLIENT_ID,
  delivery_address: '123 Harbor Dr',
  items: [{ product_id: PRODUCT_ID, quantity: 5, unit_price: 30 }],
};

const makeOrder = (overrides: Partial<OrderEntity> = {}): OrderEntity => ({
  id: ORDER_ID,
  tenant_id: TENANT_ID,
  order_number: 'ORD-20260310-00001',
  client_id: CLIENT_ID,
  status: OrderStatus.DRAFT,
  delivery_address: '123 Harbor Dr',
  delivery_deadline: null,
  yacht_name: null,
  special_instructions: null,
  total_amount: 150,
  assigned_to: null,
  created_by: 'user-1',
  confirmed_at: null,
  shipped_at: null,
  delivered_at: null,
  kanban_task_id: null,
  created_at: NOW,
  updated_at: NOW,
  client: null,
  items: [],
  ...overrides,
});

const makeRepository = (
  overrides: Partial<OrderWriteRepository> = {},
): OrderWriteRepository => ({
  createWithItems: () => Effect.succeed(makeOrder()),
  deleteDraftWithItems: () => Effect.succeed('deleted'),
  getNextOrderNumberSequence: () => Effect.succeed(1),
  transitionStatus: () => Effect.succeed(true),
  update: () => Effect.succeed(makeOrder()),
  ...overrides,
});

const makeWorkflows = ({
  repository,
  clientExists = () => Effect.succeed(true),
  productExists = () => Effect.succeed(true),
  getOrderOrFail = (id: string) => Effect.succeed(makeOrder({ id })),
}: {
  readonly repository: OrderWriteRepository;
  readonly clientExists?: (clientId: string) => Effect.Effect<boolean>;
  readonly productExists?: (productId: string) => Effect.Effect<boolean>;
  readonly getOrderOrFail?: (id: string) => Effect.Effect<OrderEntity>;
}) =>
  makeOrderWriteWorkflows({
    repository,
    clientExists,
    productExists,
    getOrderOrFail,
  });

describe('makeOrderWriteWorkflows', () => {
  it.effect(
    'creates an order after validating client and product references',
    () =>
      Effect.gen(function* () {
        vi.useFakeTimers().setSystemTime(NOW);
        let checkedClient: string | undefined;
        let checkedProduct: string | undefined;
        let capturedOrder: CreateOrderData | undefined;
        let capturedItems: CreateOrderItems | undefined;
        const repository = makeRepository({
          createWithItems: (order, items) =>
            Effect.sync(() => {
              capturedOrder = order;
              capturedItems = items;
              return makeOrder({ id: 'created-order' });
            }),
        });
        const workflows = makeWorkflows({
          repository,
          clientExists: (clientId) =>
            Effect.sync(() => {
              checkedClient = clientId;
              return true;
            }),
          productExists: (productId) =>
            Effect.sync(() => {
              checkedProduct = productId;
              return true;
            }),
          getOrderOrFail: (id) => Effect.succeed(makeOrder({ id })),
        });

        const result = yield* workflows.create(createDto, 'user-1');

        expect(checkedClient).toBe(CLIENT_ID);
        expect(checkedProduct).toBe(PRODUCT_ID);
        expect(capturedOrder).toMatchObject({
          client_id: CLIENT_ID,
          total_amount: 150,
          created_by: 'user-1',
          status: OrderStatus.DRAFT,
          order_number: 'ORD-20260310-00001',
        });
        expect(capturedItems).toEqual([
          {
            product_id: PRODUCT_ID,
            quantity: 5,
            unit_price: 30,
            subtotal: 150,
            notes: null,
          },
        ]);
        expect(result).toMatchObject({ id: 'created-order' });
        vi.useRealTimers();
      }),
  );

  it.effect('updates only defined mutable order fields', () =>
    Effect.gen(function* () {
      let current = makeOrder();
      let capturedUpdate: UpdateOrderData | undefined;
      const repository = makeRepository({
        update: (_id, data) =>
          Effect.sync(() => {
            capturedUpdate = data;
            current = makeOrder({ ...current, ...data });
            return current;
          }),
      });
      const workflows = makeWorkflows({
        repository,
        getOrderOrFail: () => Effect.succeed(current),
      });
      const dto: UpdateOrderDto = {
        delivery_address: 'New Address',
        yacht_name: 'M/Y Example',
      };

      const result = yield* workflows.update(ORDER_ID, dto);

      expect(capturedUpdate).toEqual({
        delivery_address: 'New Address',
        yacht_name: 'M/Y Example',
      });
      expect(result).toMatchObject({
        delivery_address: 'New Address',
        yacht_name: 'M/Y Example',
      });
    }),
  );

  it.effect('updates status through the status transition helper', () =>
    Effect.gen(function* () {
      vi.useFakeTimers().setSystemTime(NOW);
      let current = makeOrder({ status: OrderStatus.DRAFT });
      let capturedTransition:
        | {
            readonly expectedStatus: OrderStatus;
            readonly data: TransitionOrderData;
          }
        | undefined;
      const repository = makeRepository({
        transitionStatus: (_id, expectedStatus, data) =>
          Effect.sync(() => {
            capturedTransition = { expectedStatus, data };
            current = makeOrder({ ...current, ...data });
            return true;
          }),
      });
      const workflows = makeWorkflows({
        repository,
        getOrderOrFail: () => Effect.succeed(current),
      });

      const result = yield* workflows.updateStatus(ORDER_ID, {
        status: OrderStatus.CONFIRMED,
      });

      expect(capturedTransition).toMatchObject({
        expectedStatus: OrderStatus.DRAFT,
        data: {
          status: OrderStatus.CONFIRMED,
          confirmed_at: NOW,
        },
      });
      expect(result.status).toBe(OrderStatus.CONFIRMED);
      vi.useRealTimers();
    }),
  );

  it.effect('returns a domain conflict when the status compare-and-set loses', () =>
    Effect.gen(function* () {
      const workflows = makeWorkflows({
        repository: makeRepository({
          transitionStatus: () => Effect.succeed(false),
        }),
        getOrderOrFail: () =>
          Effect.succeed(makeOrder({ status: OrderStatus.DRAFT })),
      });

      const error = yield* Effect.flip(
        workflows.updateStatus(ORDER_ID, {
          status: OrderStatus.CONFIRMED,
        }),
      );

      expect(error).toMatchObject({
        _tag: 'OrderStatusTransitionConflict',
        statusCode: 409,
        orderId: ORDER_ID,
        from: OrderStatus.DRAFT,
        to: OrderStatus.CONFIRMED,
      });
    }),
  );

  it.effect(
    'deletes draft orders through the transactional repository method',
    () =>
      Effect.gen(function* () {
        let deletedId: string | undefined;
        const repository = makeRepository({
          deleteDraftWithItems: (id) =>
            Effect.sync(() => {
              deletedId = id;
              return 'deleted' as const;
            }),
        });
        const workflows = makeWorkflows({ repository });

        yield* workflows.delete(ORDER_ID);

        expect(deletedId).toBe(ORDER_ID);
      }),
  );
});
