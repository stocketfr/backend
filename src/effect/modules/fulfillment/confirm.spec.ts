import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { OrderStatus } from '@stocket/types/orders';
import type { Order, OrderItem } from '../orders/types';
import { confirmOrder, type FulfillmentConfirmRepository } from './confirm';

const now = new Date('2026-03-10T00:00:00.000Z');
const confirmedAt = new Date('2026-03-10T10:00:00.000Z');

const makeOrderItem = (overrides: Partial<OrderItem> = {}): OrderItem => ({
  id: 'item-1',
  order_id: 'order-1',
  product_id: 'product-1',
  quantity: 5,
  unit_price: 30,
  subtotal: 150,
  notes: null,
  quantity_picked: 0,
  quantity_packed: 0,
  created_at: now,
  updated_at: now,
  product: {
    name: 'Widget',
    sku: 'WGT-001',
  },
  ...overrides,
});

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
  id: 'order-1',
  tenant_id: 'tenant-1',
  order_number: 'ORD-20260310-00001',
  client_id: 'client-1',
  status: OrderStatus.DRAFT,
  delivery_deadline: null,
  delivery_address: '123 Harbor Dr',
  yacht_name: null,
  special_instructions: null,
  total_amount: 150,
  assigned_to: null,
  created_by: 'user-1',
  confirmed_at: null,
  shipped_at: null,
  delivered_at: null,
  kanban_task_id: null,
  created_at: now,
  updated_at: now,
  client: { company_name: 'Acme Corp' },
  items: [makeOrderItem()],
  ...overrides,
});

const makeRepository = (
  overrides: Partial<FulfillmentConfirmRepository> = {},
): FulfillmentConfirmRepository => {
  let order = makeOrder();

  return {
    findByIdWithRelations: () => Effect.succeed(order),
    transitionStatus: (_orderId, _expectedStatus, data) =>
      Effect.sync(() => {
        order = {
          ...order,
          status: data.status,
          confirmed_at: data.confirmed_at,
          assigned_to: data.assigned_to,
        };
        return true;
      }),
    ...overrides,
  };
};

describe('confirmOrder', () => {
  it.effect(
    'confirms a draft order, reloads it, and returns the fulfillment view',
    () =>
      Effect.gen(function* () {
        let update:
          | {
              readonly orderId: string;
              readonly status: OrderStatus;
              readonly confirmedAt: Date;
              readonly assignedTo: string;
            }
          | undefined;
        const repository = makeRepository({
          transitionStatus: (orderId, expectedStatus, data) =>
            Effect.sync(() => {
              expect(expectedStatus).toBe(OrderStatus.DRAFT);
              update = {
                orderId,
                status: data.status,
                confirmedAt: data.confirmed_at,
                assignedTo: data.assigned_to,
              };
              return true;
            }),
          findByIdWithRelations: () =>
            Effect.succeed(
              update
                ? makeOrder({
                    status: update.status,
                    confirmed_at: update.confirmedAt,
                    assigned_to: update.assignedTo,
                  })
                : makeOrder(),
            ),
        });

        const result = yield* confirmOrder({
          repository,
          orderId: 'order-1',
          actorId: 'user-2',
          now: () => confirmedAt,
        });

        expect(update).toEqual({
          orderId: 'order-1',
          status: OrderStatus.CONFIRMED,
          confirmedAt,
          assignedTo: 'user-2',
        });
        expect(result).toMatchObject({
          orderId: 'order-1',
          status: OrderStatus.CONFIRMED,
          confirmedAt,
          items: [
            {
              orderItemId: 'item-1',
              quantity: 5,
              quantityPicked: 0,
              quantityPacked: 0,
            },
          ],
        });
      }),
  );

  it.effect('rejects non-draft orders before updating', () =>
    Effect.gen(function* () {
      let updateCalled = false;
      const repository = makeRepository({
        findByIdWithRelations: () =>
          Effect.succeed(makeOrder({ status: OrderStatus.CONFIRMED })),
        transitionStatus: () =>
          Effect.sync(() => {
            updateCalled = true;
            return true;
          }),
      });

      const error = yield* Effect.flip(
        confirmOrder({
          repository,
          orderId: 'order-1',
          actorId: 'user-2',
          now: () => confirmedAt,
        }),
      );

      expect(error).toMatchObject({
        _tag: 'FulfillmentInvalidTransition',
        orderId: 'order-1',
        from: OrderStatus.CONFIRMED,
        to: OrderStatus.CONFIRMED,
      });
      expect(updateCalled).toBe(false);
    }),
  );

  it.effect('fails when the order is missing', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        confirmOrder({
          repository: makeRepository({
            findByIdWithRelations: () => Effect.succeed(null),
          }),
          orderId: 'missing-order',
          actorId: 'user-2',
          now: () => confirmedAt,
        }),
      );

      expect(error).toMatchObject({
        _tag: 'FulfillmentOrderNotFound',
        orderId: 'missing-order',
      });
    }),
  );

  it.effect('returns a domain conflict when confirmation loses the status race', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        confirmOrder({
          repository: makeRepository({
            transitionStatus: () => Effect.succeed(false),
          }),
          orderId: 'order-1',
          actorId: 'user-2',
          now: () => confirmedAt,
        }),
      );

      expect(error).toMatchObject({
        _tag: 'OrderStatusTransitionConflict',
        statusCode: 409,
        orderId: 'order-1',
        from: OrderStatus.DRAFT,
        to: OrderStatus.CONFIRMED,
      });
    }),
  );

  it.effect('wraps repository update failures as infrastructure errors', () =>
    Effect.gen(function* () {
      const cause = new Error('write failed');

      const error = yield* Effect.flip(
        confirmOrder({
          repository: makeRepository({
            transitionStatus: () => Effect.fail(cause),
          }),
          orderId: 'order-1',
          actorId: 'user-2',
          now: () => confirmedAt,
        }),
      );

      expect(error).toMatchObject({
        _tag: 'FulfillmentInfrastructureError',
        action: 'confirm order',
      });
      expect(error.cause).toBe(cause);
    }),
  );
});
