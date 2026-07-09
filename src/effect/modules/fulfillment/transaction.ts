import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { DrizzleDatabase, type DrizzleDb } from '../../platform/db/drizzle';
import { withDrizzleTransaction } from '../../platform/db/transaction';
import { CurrentRequestContext } from '../../platform/http/request-context';
import { InventoryRepository } from '../inventory/repository';
import { OrderItemsRepository } from '../orders/order-items.repository';
import { OrdersRepository } from '../orders/repository';
import { StockMovementsRepository } from '../stock-movements/repository';
import type { FulfillmentError } from './errors';
import { wrapFulfillmentInfrastructureError } from './pick';

export interface FulfillmentTransactionRepositories {
  readonly ordersRepository: OrdersRepository;
  readonly orderItemsRepository: OrderItemsRepository;
  readonly inventoryRepository: InventoryRepository;
  readonly stockMovementsRepository: StockMovementsRepository;
}

// Thrown only across Drizzle's Promise transaction callback. Typed failures are
// carried in `failure`; defects/interrupts keep the pretty cause for diagnostics.
export class FulfillmentTransactionDefect extends Error {
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

export const runFulfillmentEffectAsPromise = async <
  A,
  E extends FulfillmentError,
>(
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

export const runFulfillmentTransaction = <A, E extends FulfillmentError>({
  db,
  effect,
}: {
  readonly db: DrizzleDb;
  readonly effect: (
    repositories: FulfillmentTransactionRepositories,
  ) => Effect.Effect<A, E, never>;
}) =>
  Effect.gen(function* () {
    const requestContext = yield* Effect.serviceOption(CurrentRequestContext);

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
            const txStockMovementsRepository = yield* StockMovementsRepository;

            return yield* effect({
              ordersRepository: txOrdersRepository,
              orderItemsRepository: txOrderItemsRepository,
              inventoryRepository: txInventoryRepository,
              stockMovementsRepository: txStockMovementsRepository,
            });
          }).pipe(Effect.provide(txRepositoriesLayer));

          return runFulfillmentEffectAsPromise(txEffect);
        }),
      catch: (cause) =>
        cause instanceof FulfillmentTransactionDefect && cause.failure !== null
          ? cause.failure
          : wrapFulfillmentInfrastructureError('pick transaction')(cause),
    });
  });
