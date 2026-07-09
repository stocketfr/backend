import { Effect } from 'effect';
import { describe, expect, it } from '@effect/vitest';
import { OrderStatus } from '@stocket/types/orders';
import { StockMovementReason } from '@stocket/types/stock-movements';
import type { Order, OrderItem } from '../orders/types';
import {
  ensurePickableOrder,
  pickOrder,
  type FulfillmentPickRepositories,
} from './pick';

const now = new Date('2026-03-10T00:00:00.000Z');

const makeOrderItem = (
  overrides: Partial<OrderItem> & {
    readonly id: string;
    readonly product_id: string;
  },
): OrderItem => ({
  order_id: 'order-1',
  quantity: 5,
  unit_price: 30,
  subtotal: 150,
  notes: null,
  quantity_picked: 0,
  quantity_packed: 0,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
  id: 'order-1',
  tenant_id: 'tenant-1',
  order_number: 'ORD-20260310-00001',
  client_id: 'client-1',
  status: OrderStatus.CONFIRMED,
  delivery_address: '123 Harbor Dr',
  delivery_deadline: null,
  yacht_name: null,
  special_instructions: null,
  total_amount: 150,
  assigned_to: 'user-2',
  created_by: 'user-1',
  confirmed_at: new Date('2026-03-10T10:00:00.000Z'),
  shipped_at: null,
  delivered_at: null,
  kanban_task_id: null,
  created_at: now,
  updated_at: now,
  client: { company_name: 'Acme Corp' },
  items: [
    makeOrderItem({
      id: 'item-1',
      product_id: 'product-1',
    }),
  ],
  ...overrides,
});

const makeRepositories = (
  options: {
    readonly orderStatus?: OrderStatus;
    readonly items?: readonly OrderItem[];
    readonly adjustRows?: number;
    readonly incrementRows?: number;
  } = {},
) => {
  let item =
    options.items?.[0] ??
    makeOrderItem({ id: 'item-1', product_id: 'product-1' });
  let order = makeOrder({
    status: options.orderStatus ?? OrderStatus.CONFIRMED,
    items: options.items === undefined ? [item] : [...options.items],
  });
  const updates: Array<{ readonly status: OrderStatus }> = [];
  const inventoryAdjustments: Array<{
    readonly inventoryId: string;
    readonly adjustment: number;
  }> = [];
  const stockMovements: Array<{
    readonly product_id: string;
    readonly from_location_id: string | null;
    readonly quantity: number;
    readonly reason: StockMovementReason;
    readonly order_id: string;
    readonly user_id: string;
  }> = [];

  const repositories = {
    ordersRepository: {
      findByIdWithRelations: () => Effect.succeed(order),
      update: (_orderId, data) =>
        Effect.sync(() => {
          updates.push(data);
          order = { ...order, ...data };
          return 1;
        }),
    },
    orderItemsRepository: {
      findByIds: () =>
        Effect.sync(() =>
          options.items === undefined ? [item] : options.items,
        ),
      incrementPicked: (_orderItemId, quantity) =>
        Effect.sync(() => {
          const rows = options.incrementRows ?? 1;
          if (rows === 0) return 0;
          item = { ...item, quantity_picked: item.quantity_picked + quantity };
          order = { ...order, items: [item] };
          return rows;
        }),
    },
    inventoryRepository: {
      adjustQuantity: (inventoryId, adjustment) =>
        Effect.sync(() => {
          inventoryAdjustments.push({ inventoryId, adjustment });
          return options.adjustRows ?? 1;
        }),
      findByIdWithRelations: () =>
        Effect.succeed({ location_id: 'location-1' }),
    },
    stockMovementsRepository: {
      create: (data) =>
        Effect.sync(() => {
          stockMovements.push(data);
          return { id: `movement-${stockMovements.length}` };
        }),
    },
  } satisfies FulfillmentPickRepositories;

  return {
    repositories,
    updates,
    inventoryAdjustments,
    stockMovements,
  };
};

describe('ensurePickableOrder', () => {
  it.effect('fails draft orders with the pick transition error', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ensurePickableOrder(
          makeOrder({ status: OrderStatus.DRAFT }),
          'order-1',
        ),
      );

      expect(error).toMatchObject({
        _tag: 'FulfillmentInvalidTransition',
        from: OrderStatus.DRAFT,
        to: OrderStatus.PICKING,
      });
    }),
  );
});

describe('pickOrder', () => {
  it.effect(
    'transitions confirmed orders, picks inventory, and records stock movement',
    () =>
      Effect.gen(function* () {
        const state = makeRepositories();

        const result = yield* pickOrder({
          repositories: state.repositories,
          input: {
            orderId: 'order-1',
            actorId: 'user-2',
            picks: [
              {
                orderItemId: 'item-1',
                inventoryId: 'inventory-1',
                quantity: 2,
              },
            ],
          },
        });

        expect(result).toMatchObject({
          orderId: 'order-1',
          status: OrderStatus.PICKING,
          items: [{ orderItemId: 'item-1', quantityPicked: 2 }],
        });
        expect(state.updates).toEqual([{ status: OrderStatus.PICKING }]);
        expect(state.inventoryAdjustments).toEqual([
          { inventoryId: 'inventory-1', adjustment: -2 },
        ]);
        expect(state.stockMovements).toEqual([
          {
            product_id: 'product-1',
            from_location_id: 'location-1',
            quantity: 2,
            reason: StockMovementReason.SALE,
            order_id: 'order-1',
            user_id: 'user-2',
          },
        ]);
      }),
  );

  it.effect('fails when a picked item does not belong to the order', () =>
    Effect.gen(function* () {
      const state = makeRepositories({ items: [] });

      const error = yield* Effect.flip(
        pickOrder({
          repositories: state.repositories,
          input: {
            orderId: 'order-1',
            actorId: 'user-2',
            picks: [
              {
                orderItemId: 'missing-item',
                inventoryId: 'inventory-1',
                quantity: 2,
              },
            ],
          },
        }),
      );

      expect(error).toMatchObject({
        _tag: 'FulfillmentPickFailed',
        orderItemId: 'missing-item',
        messageKey: 'fulfillment.orderItemNotFound',
      });
      expect(state.stockMovements).toEqual([]);
    }),
  );

  it.effect(
    'fails when the atomic picked quantity increment rejects the pick',
    () =>
      Effect.gen(function* () {
        const state = makeRepositories({ incrementRows: 0 });

        const error = yield* Effect.flip(
          pickOrder({
            repositories: state.repositories,
            input: {
              orderId: 'order-1',
              actorId: 'user-2',
              picks: [
                {
                  orderItemId: 'item-1',
                  inventoryId: 'inventory-1',
                  quantity: 9,
                },
              ],
            },
          }),
        );

        expect(error).toMatchObject({
          _tag: 'FulfillmentPickFailed',
          orderItemId: 'item-1',
          messageKey: 'fulfillment.overPick',
        });
        expect(state.stockMovements).toEqual([]);
      }),
  );
});
