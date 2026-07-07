import { Cause, Context, Effect, Exit, Layer, Option } from 'effect';
import { DrizzleDatabase, type DrizzleDb } from './db/drizzle';
import { CurrentRequestContext } from './http/request-context';

interface TransactionalDatabase {
  readonly transaction: <A>(
    callback: (tx: unknown) => Promise<A>,
  ) => Promise<A>;
}

export interface TransactionRunOptions<E, E2, R> {
  readonly layer: Layer.Layer<R, never, DrizzleDb>;
  readonly isExpectedError: (cause: unknown) => cause is E;
  readonly mapUnexpectedError: (cause: unknown) => E2;
}

export interface TransactionRunner {
  readonly run: <A, E, R, E2>(
    effect: Effect.Effect<A, E, R>,
    options: TransactionRunOptions<E, E2, R>,
  ) => Effect.Effect<A, E | E2>;
}

export const TransactionRunner = Context.GenericTag<TransactionRunner>(
  '@stocket/effect/platform/TransactionRunner',
);

// Thrown only for defects/interrupts inside a transaction callback. Typed
// failures are rethrown as-is so the transaction rolls back and the outer
// boundary can preserve the caller's domain error.
export class TransactionDefect extends Error {
  constructor(public readonly cause: Cause.Cause<unknown>) {
    super(Cause.pretty(cause));
    this.name = 'TransactionDefect';
  }
}

const runEffectAsPromise = async <A, E>(
  effect: Effect.Effect<A, E, never>,
): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;

  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;
  throw new TransactionDefect(exit.cause);
};

export const makeDrizzleTransactionRunner = (
  db: TransactionalDatabase,
): TransactionRunner => ({
  run: (effect, options) =>
    Effect.gen(function* () {
      const requestContext = yield* Effect.serviceOption(
        CurrentRequestContext,
      );

      return yield* Effect.tryPromise({
        try: () =>
          db.transaction(async (tx) => {
            // Drizzle's transaction object is structurally compatible with the
            // query surface our repositories use, but its public type is
            // nominally distinct from NodePgDatabase.
            const txDb = tx as unknown as DrizzleDb;
            let txEffect = Effect.provide(effect, options.layer).pipe(
              Effect.provideService(DrizzleDatabase, txDb),
            );

            if (Option.isSome(requestContext)) {
              txEffect = txEffect.pipe(
                Effect.provideService(
                  CurrentRequestContext,
                  requestContext.value,
                ),
              );
            }

            return runEffectAsPromise(txEffect);
          }),
        catch: (cause) =>
          options.isExpectedError(cause)
            ? cause
            : options.mapUnexpectedError(cause),
      });
    }),
});

export const drizzleTransactionLayer = Layer.effect(
  TransactionRunner,
  Effect.gen(function* () {
    const db = yield* DrizzleDatabase;
    return makeDrizzleTransactionRunner(db);
  }),
);
