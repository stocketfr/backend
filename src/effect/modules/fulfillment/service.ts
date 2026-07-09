import { Effect } from 'effect';
import type { PackInput, PickInput } from '@stocket/types/fulfillment';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { InventoryRepository } from '../inventory/repository';
import { OrderItemsRepository } from '../orders/order-items.repository';
import { OrdersRepository } from '../orders/repository';
import { StockMovementsRepository } from '../stock-movements/repository';
import {
  FulfillmentNotImplemented,
  type FulfillmentError,
} from './errors';
import { confirmOrder } from './confirm';
import {
  ensurePickableOrder,
  loadFulfillmentOrderOrFail,
  pickOrder,
} from './pick';
import { runFulfillmentTransaction } from './transaction';

export class FulfillmentService extends Effect.Service<FulfillmentService>()(
  '@stocket/effect/fulfillment/FulfillmentService',
  {
    effect: Effect.gen(function* () {
      const ordersRepository = yield* OrdersRepository;
      const orderItemsRepository = yield* OrderItemsRepository;
      const inventoryRepository = yield* InventoryRepository;
      const stockMovementsRepository = yield* StockMovementsRepository;
      // Pull DrizzleDatabase at construction time so a missing platform layer
      // fails loudly during wiring rather than silently degrading pick() to a
      // non-transactional code path at runtime.
      const db = yield* DrizzleDatabase;
      const trace = makeServiceTracer({
        serviceName: 'FulfillmentService',
        module: 'fulfillment',
        layer: 'service',
        entityType: 'order',
      });

      const loadOrderOrFail = (orderId: string) =>
        loadFulfillmentOrderOrFail(ordersRepository, orderId);

      const runPickAtomically = <A, E extends FulfillmentError>(
        effect: (repositories: {
          readonly ordersRepository: typeof ordersRepository;
          readonly orderItemsRepository: typeof orderItemsRepository;
          readonly inventoryRepository: typeof inventoryRepository;
          readonly stockMovementsRepository: typeof stockMovementsRepository;
        }) => Effect.Effect<A, E, never>,
      ) => runFulfillmentTransaction({ db, effect });

      const confirm = (orderId: string, actorId: string) =>
        confirmOrder({
          repository: ordersRepository,
          orderId,
          actorId,
          now: () => new Date(),
        }).pipe(trace.span('confirm', { attributes: { orderId } }));

      const pick = (input: {
        readonly orderId: string;
        readonly actorId: string;
        readonly picks: readonly PickInput[];
      }) =>
        Effect.gen(function* () {
          const preflightOrder = yield* loadOrderOrFail(input.orderId);
          yield* ensurePickableOrder(preflightOrder, input.orderId);

          return yield* runPickAtomically((repositories) =>
            pickOrder({ repositories, input }),
          );
        }).pipe(trace.span('pick', { attributes: { orderId: input.orderId } }));

      const pack = (input: {
        readonly orderId: string;
        readonly actorId: string;
        readonly packs: readonly PackInput[];
      }) =>
        Effect.gen(function* () {
          yield* loadOrderOrFail(input.orderId);

          void input.actorId;
          void input.packs;
          void orderItemsRepository;

          return yield* Effect.fail(
            new FulfillmentNotImplemented({
              operation: 'pack',
              messageKey: 'fulfillment.packNotImplemented',
            }),
          );
        }).pipe(trace.span('pack', { attributes: { orderId: input.orderId } }));

      const ship = (orderId: string, actorId: string) =>
        Effect.gen(function* () {
          yield* loadOrderOrFail(orderId);

          void actorId;
          void inventoryRepository;
          void stockMovementsRepository;

          return yield* Effect.fail(
            new FulfillmentNotImplemented({
              operation: 'ship',
              messageKey: 'fulfillment.shipNotImplemented',
            }),
          );
        }).pipe(trace.span('ship', { attributes: { orderId } }));

      return {
        confirm,
        pick,
        pack,
        ship,
      };
    }),
    dependencies: [
      OrdersRepository.Default,
      OrderItemsRepository.Default,
      InventoryRepository.Default,
      StockMovementsRepository.Default,
    ],
  },
) {}
