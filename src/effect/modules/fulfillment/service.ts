import { Cause, Effect, Exit, Layer, Option } from 'effect';
import type {
  OrderFulfillmentView,
  PackInput,
  PickInput,
} from '@stocket/types/fulfillment';
import { fromNullOr } from '../../platform/effect/from-null-or';
import { OrderStatus } from '@stocket/types/orders';
import { StockMovementReason } from '@stocket/types/stock-movements';
import { DrizzleDatabase, type DrizzleDb } from '../../platform/db/drizzle';
import { withDrizzleTransaction } from '../../platform/db/transaction';
import { CurrentRequestContext } from '../../platform/http/request-context';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { InventoryRepository } from '../inventory/repository';
import { OrderItemsRepository, OrdersRepository } from '../orders/repository';
import type { Order } from '../orders/orders.utils';
import { StockMovementsRepository } from '../stock-movements/repository';
import {
  FulfillmentInfrastructureError,
  FulfillmentInvalidTransition,
  FulfillmentNotImplemented,
  FulfillmentOrderNotFound,
  FulfillmentPickFailed,
  type FulfillmentError,
} from './errors';

// Thrown only across Drizzle's Promise transaction callback. Typed failures are
// carried in `failure`; defects/interrupts keep the pretty cause for diagnostics.
class FulfillmentTransactionDefect extends Error {
  private constructor(
    message: string,
    public readonly failure: FulfillmentError | null,
    public readonly defectCause: Cause.Cause<unknown> | null,
  ) {
    super(message);
    this.name = 'FulfillmentTransactionDefect';
  }

  static failure(failure: FulfillmentError) {
    return new FulfillmentTransactionDefect(failure.message, failure, null);
  }

  static defect(cause: Cause.Cause<unknown>) {
    return new FulfillmentTransactionDefect(Cause.pretty(cause), null, cause);
  }
}

const runEffectAsPromise = async <A, E extends FulfillmentError>(
  effect: Effect.Effect<A, E, never>,
): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;

  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    throw FulfillmentTransactionDefect.failure(failure.value);
  }
  throw FulfillmentTransactionDefect.defect(exit.cause);
};

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

      const wrapInfrastructureError = (action: string) => (cause: unknown) =>
        new FulfillmentInfrastructureError({
          action,
          cause,
          messageKey: 'fulfillment.infrastructureFailed',
        });

      const loadOrderOrFailFrom = (
        repository: typeof ordersRepository,
        orderId: string,
      ) =>
        fromNullOr(
          Effect.mapError(
            repository.findByIdWithRelations(orderId),
            wrapInfrastructureError('load order'),
          ),
          () =>
            new FulfillmentOrderNotFound({
              orderId,
              messageKey: 'fulfillment.orderNotFound',
            }),
        );

      const loadOrderOrFail = (orderId: string) =>
        loadOrderOrFailFrom(ordersRepository, orderId);

      const toView = (order: Order): OrderFulfillmentView => ({
        orderId: order.id,
        status: order.status,
        confirmedAt: order.confirmed_at,
        shippedAt: order.shipped_at,
        deliveredAt: order.delivered_at,
        items: (order.items ?? []).map((item) => ({
          orderItemId: item.id,
          productId: item.product_id,
          quantity: item.quantity,
          quantityPicked: item.quantity_picked,
          quantityPacked: item.quantity_packed,
        })),
      });

      const runPickAtomically = <A, E extends FulfillmentError>(
        effect: (repositories: {
          readonly ordersRepository: typeof ordersRepository;
          readonly orderItemsRepository: typeof orderItemsRepository;
          readonly inventoryRepository: typeof inventoryRepository;
          readonly stockMovementsRepository: typeof stockMovementsRepository;
        }) => Effect.Effect<A, E, never>,
      ) =>
        Effect.gen(function* () {
          const requestContext = yield* Effect.serviceOption(
            CurrentRequestContext,
          );

          return yield* Effect.tryPromise({
            try: () =>
              withDrizzleTransaction(db, async (txDb) => {
                let txPlatformLayer: Layer.Layer<DrizzleDb> = Layer.succeed(
                  DrizzleDatabase,
                  txDb,
                );
                if (Option.isSome(requestContext)) {
                  txPlatformLayer = Layer.merge(
                    txPlatformLayer,
                    Layer.succeed(CurrentRequestContext, requestContext.value),
                  );
                }
                const txRepositoriesLayer = Layer.mergeAll(
                  OrdersRepository.Default,
                  OrderItemsRepository.Default,
                  InventoryRepository.Default,
                  StockMovementsRepository.Default,
                ).pipe(Layer.provide(txPlatformLayer));

                const txEffect = Effect.gen(function* () {
                  const txOrdersRepository = yield* OrdersRepository;
                  const txOrderItemsRepository = yield* OrderItemsRepository;
                  const txInventoryRepository = yield* InventoryRepository;
                  const txStockMovementsRepository =
                    yield* StockMovementsRepository;

                  return yield* effect({
                    ordersRepository: txOrdersRepository,
                    orderItemsRepository: txOrderItemsRepository,
                    inventoryRepository: txInventoryRepository,
                    stockMovementsRepository: txStockMovementsRepository,
                  });
                }).pipe(Effect.provide(txRepositoriesLayer));

                return runEffectAsPromise(txEffect);
              }),
            catch: (cause) =>
              cause instanceof FulfillmentTransactionDefect &&
              cause.failure !== null
                ? cause.failure
                : wrapInfrastructureError('pick transaction')(cause),
          });
        });

      const confirm = (orderId: string, actorId: string) =>
        Effect.gen(function* () {
          const order = yield* loadOrderOrFail(orderId);

          if (order.status !== OrderStatus.DRAFT) {
            return yield* Effect.fail(
              new FulfillmentInvalidTransition({
                orderId,
                from: order.status,
                to: OrderStatus.CONFIRMED,
                messageKey: 'fulfillment.onlyDraftCanConfirm',
              }),
            );
          }

          yield* ordersRepository
            .update(orderId, {
              status: OrderStatus.CONFIRMED,
              confirmed_at: new Date(),
              assigned_to: actorId,
            })
            .pipe(Effect.mapError(wrapInfrastructureError('confirm order')));

          const updated = yield* loadOrderOrFail(orderId);
          return toView(updated);
        }).pipe(trace.span('confirm', { attributes: { orderId } }));

      const PICKABLE_STATUSES: readonly OrderStatus[] = [
        OrderStatus.CONFIRMED,
        OrderStatus.PICKING,
      ];

      const pick = (input: {
        readonly orderId: string;
        readonly actorId: string;
        readonly picks: readonly PickInput[];
      }) =>
        Effect.gen(function* () {
          const preflightOrder = yield* loadOrderOrFail(input.orderId);

          if (!PICKABLE_STATUSES.includes(preflightOrder.status)) {
            return yield* Effect.fail(
              new FulfillmentInvalidTransition({
                orderId: input.orderId,
                from: preflightOrder.status,
                to: OrderStatus.PICKING,
                messageKey: 'fulfillment.notPickable',
              }),
            );
          }

          return yield* runPickAtomically((repositories) =>
            Effect.gen(function* () {
              const order = yield* loadOrderOrFailFrom(
                repositories.ordersRepository,
                input.orderId,
              );

              if (!PICKABLE_STATUSES.includes(order.status)) {
                return yield* Effect.fail(
                  new FulfillmentInvalidTransition({
                    orderId: input.orderId,
                    from: order.status,
                    to: OrderStatus.PICKING,
                    messageKey: 'fulfillment.notPickable',
                  }),
                );
              }

              if (order.status === OrderStatus.CONFIRMED) {
                yield* repositories.ordersRepository
                  .update(input.orderId, { status: OrderStatus.PICKING })
                  .pipe(
                    Effect.mapError(
                      wrapInfrastructureError('transition to picking'),
                    ),
                  );
              }

              const itemIds = input.picks.map((p) => p.orderItemId);
              const items = yield* repositories.orderItemsRepository
                .findByIds(itemIds)
                .pipe(
                  Effect.mapError(wrapInfrastructureError('load order items')),
                );
              const itemMap = new Map((items ?? []).map((i) => [i.id, i]));

              for (const p of input.picks) {
                const item = itemMap.get(p.orderItemId);
                if (!item || item.order_id !== input.orderId) {
                  return yield* Effect.fail(
                    new FulfillmentPickFailed({
                      orderItemId: p.orderItemId,
                      messageKey: 'fulfillment.orderItemNotFound',
                    }),
                  );
                }

                // Decrement inventory first — fail fast if stock is unavailable
                yield* repositories.inventoryRepository
                  .adjustQuantity(p.inventoryId, -p.quantity)
                  .pipe(
                    Effect.mapError(
                      wrapInfrastructureError('decrement inventory'),
                    ),
                    Effect.filterOrFail(
                      (rows) => rows !== 0,
                      () =>
                        new FulfillmentPickFailed({
                          orderItemId: p.orderItemId,
                          messageKey: 'fulfillment.insufficientInventory',
                        }),
                    ),
                  );

                // Atomic increment — returns 0 rows if it would over-pick
                yield* repositories.orderItemsRepository
                  .incrementPicked(p.orderItemId, p.quantity)
                  .pipe(
                    Effect.mapError(
                      wrapInfrastructureError('increment quantity_picked'),
                    ),
                    Effect.filterOrFail(
                      (rows) => rows !== 0,
                      () =>
                        new FulfillmentPickFailed({
                          orderItemId: p.orderItemId,
                          messageKey: 'fulfillment.overPick',
                        }),
                    ),
                  );

                const inv = yield* repositories.inventoryRepository
                  .findById(p.inventoryId)
                  .pipe(
                    Effect.mapError(wrapInfrastructureError('load inventory')),
                  );

                yield* repositories.stockMovementsRepository
                  .create({
                    product_id: item.product_id,
                    from_location_id: inv?.location_id ?? null,
                    quantity: p.quantity,
                    reason: StockMovementReason.SALE,
                    order_id: input.orderId,
                    user_id: input.actorId,
                  })
                  .pipe(
                    Effect.mapError(
                      wrapInfrastructureError('create stock movement'),
                    ),
                  );
              }

              const updated = yield* loadOrderOrFailFrom(
                repositories.ordersRepository,
                input.orderId,
              );
              return toView(updated);
            }),
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
