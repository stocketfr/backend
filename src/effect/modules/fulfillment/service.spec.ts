import { type Mock } from 'vitest';
import { Effect, Layer } from 'effect';
import { OrderStatus } from '@stocket/types/orders';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { InventoryRepository } from '../inventory/repository';
import { OrderItemsRepository } from '../orders/order-items.repository';
import { OrdersRepository } from '../orders/repository';
import { StockMovementsRepository } from '../stock-movements/repository';
import { FulfillmentService } from './service';

// Unit-test stub: the service constructor pulls DrizzleDatabase to wire the
// pick transaction, but the unit specs deliberately exercise paths that never
// reach `db.transaction` (status-rejection, pack/ship not-implemented, confirm
// via mocked repositories). Providing a typed-but-unused stub keeps the unit
// surface free of a real DB while still satisfying the requirement statically.
const stubDrizzleLayer = Layer.succeed(DrizzleDatabase, {} as never);

const makeOrderItemEntity = (overrides: Record<string, any> = {}) => ({
  id: 'item-1',
  order_id: 'order-1',
  product_id: 'product-1',
  product: {
    id: 'product-1',
    name: 'Widget',
    sku: 'WGT-001',
  },
  quantity: 5,
  unit_price: 30,
  subtotal: 150,
  notes: null,
  quantity_picked: 0,
  quantity_packed: 0,
  created_at: new Date('2026-03-10T00:00:00.000Z'),
  updated_at: new Date('2026-03-10T00:00:00.000Z'),
  ...overrides,
});

const makeOrderEntity = (overrides: Record<string, any> = {}) => ({
  id: 'order-1',
  order_number: 'ORD-20260310-00001',
  client_id: 'client-1',
  client: {
    id: 'client-1',
    company_name: 'Acme Corp',
  },
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
  items: [makeOrderItemEntity()],
  created_at: new Date('2026-03-10T00:00:00.000Z'),
  updated_at: new Date('2026-03-10T00:00:00.000Z'),
  ...overrides,
});

const makeMockOrdersRepository = (overrides: Record<string, Mock> = {}) => {
  const findByIdWithRelations = vi
    .fn()
    .mockReturnValueOnce(Effect.succeed(makeOrderEntity()))
    .mockReturnValueOnce(
      Effect.succeed(
        makeOrderEntity({
          status: OrderStatus.CONFIRMED,
          assigned_to: 'user-2',
          confirmed_at: new Date('2026-03-10T10:00:00.000Z'),
        }),
      ),
    );

  return {
    findAllPaginated: vi.fn(),
    findById: findByIdWithRelations,
    findByIdWithRelations,
    create: vi.fn(),
    update: vi.fn().mockReturnValue(Effect.succeed(1)),
    delete: vi.fn(),
    getNextOrderNumberSequence: vi.fn(),
    existsById: vi.fn(),
    ...overrides,
  };
};

const buildService = (
  ordersRepository = makeMockOrdersRepository(),
  orderItemsRepository = {} as any,
  inventoryRepository = {} as any,
  stockMovementsRepository = {} as any,
) =>
  Effect.runPromise(
    FulfillmentService.pipe(
      Effect.provide(
        FulfillmentService.DefaultWithoutDependencies.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(OrdersRepository, ordersRepository as any),
              Layer.succeed(OrderItemsRepository, orderItemsRepository),
              Layer.succeed(InventoryRepository, inventoryRepository),
              Layer.succeed(StockMovementsRepository, stockMovementsRepository),
              stubDrizzleLayer,
            ),
          ),
        ),
      ),
    ),
  );

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const fail = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(effect));

function expectTag<T extends { _tag: string }, K extends T['_tag']>(
  error: T,
  tag: K,
): asserts error is Extract<T, { _tag: K }> {
  expect(error._tag).toBe(tag);
}

describe('Effect FulfillmentService', () => {
  describe('confirm', () => {
    it('confirms a draft order and returns the fulfillment view', async () => {
      vi.useFakeTimers().setSystemTime(new Date('2026-03-10T10:00:00.000Z'));

      const ordersRepository = makeMockOrdersRepository();
      const service = await buildService(ordersRepository);

      const result = await run(service.confirm('order-1', 'user-2'));

      expect(ordersRepository.update).toHaveBeenCalledWith('order-1', {
        status: OrderStatus.CONFIRMED,
        confirmed_at: new Date('2026-03-10T10:00:00.000Z'),
        assigned_to: 'user-2',
      });
      expect(result).toMatchObject({
        orderId: 'order-1',
        status: OrderStatus.CONFIRMED,
        confirmedAt: new Date('2026-03-10T10:00:00.000Z'),
        shippedAt: null,
        deliveredAt: null,
        items: [
          {
            orderItemId: 'item-1',
            productId: 'product-1',
            quantity: 5,
            quantityPicked: 0,
            quantityPacked: 0,
          },
        ],
      });

      vi.useRealTimers();
    });

    it('fails when confirming a non-draft order', async () => {
      const ordersRepository = makeMockOrdersRepository({
        findByIdWithRelations: vi.fn().mockReturnValue(
          Effect.succeed(
            makeOrderEntity({
              status: OrderStatus.CONFIRMED,
              confirmed_at: new Date('2026-03-10T10:00:00.000Z'),
            }),
          ),
        ),
        update: vi.fn().mockReturnValue(Effect.succeed(1)),
      });
      const service = await buildService(ordersRepository);

      const error = await fail(service.confirm('order-1', 'user-2'));

      expectTag(error, 'FulfillmentInvalidTransition');
      expect(error.orderId).toBe('order-1');
      expect(error.from).toBe(OrderStatus.CONFIRMED);
      expect(error.to).toBe(OrderStatus.CONFIRMED);
      expect(ordersRepository.update).not.toHaveBeenCalled();
    });

    it('fails when the order does not exist', async () => {
      const ordersRepository = makeMockOrdersRepository({
        findByIdWithRelations: vi.fn().mockReturnValue(Effect.succeed(null)),
      });
      const service = await buildService(ordersRepository);

      const error = await fail(service.confirm('missing-order', 'user-2'));

      expectTag(error, 'FulfillmentOrderNotFound');
      expect(error.orderId).toBe('missing-order');
    });

    it('wraps repository failures as infrastructure errors', async () => {
      const cause = new Error('write failed');
      const ordersRepository = makeMockOrdersRepository({
        update: vi.fn().mockReturnValue(Effect.fail(cause)),
      });
      const service = await buildService(ordersRepository);

      const error = await fail(service.confirm('order-1', 'user-2'));

      expectTag(error, 'FulfillmentInfrastructureError');
      expect(error.action).toBe('confirm order');
      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).toBe('write failed');
    });
  });

  describe('pick', () => {
    it('rejects pick for non-pickable order status', async () => {
      const service = await buildService();

      const error = await fail(
        service.pick({
          orderId: 'order-1',
          actorId: 'user-2',
          picks: [
            { orderItemId: 'item-1', inventoryId: 'inventory-1', quantity: 2 },
          ],
        }),
      );

      expectTag(error, 'FulfillmentInvalidTransition');
      expect(error.orderId).toBe('order-1');
      expect(error.from).toBe(OrderStatus.DRAFT);
      expect(error.to).toBe(OrderStatus.PICKING);
    });
  });

  describe('pack', () => {
    it('fails with not implemented for a known order', async () => {
      const service = await buildService();

      const error = await fail(
        service.pack({
          orderId: 'order-1',
          actorId: 'user-2',
          packs: [{ orderItemId: 'item-1', quantity: 2 }],
        }),
      );

      expectTag(error, 'FulfillmentNotImplemented');
      expect(error.operation).toBe('pack');
    });
  });

  describe('ship', () => {
    it('fails with not implemented for a known order', async () => {
      const service = await buildService();

      const error = await fail(service.ship('order-1', 'user-2'));

      expectTag(error, 'FulfillmentNotImplemented');
      expect(error.operation).toBe('ship');
    });
  });
});
