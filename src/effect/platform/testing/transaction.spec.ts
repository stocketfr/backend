import { Context, Data, Effect, Layer, Option } from 'effect';
import type { DrizzleDb } from '../db/drizzle';
import { DrizzleDatabase } from '../db/drizzle';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../http/request-context';
import {
  TransactionDefect,
  makeDrizzleTransactionRunner,
} from '../transaction';

class ExpectedTransactionError extends Data.TaggedError(
  'ExpectedTransactionError',
)<{
  readonly reason: string;
}> {}

class MappedTransactionError extends Data.TaggedError(
  'MappedTransactionError',
)<{
  readonly cause: unknown;
}> {}

interface TransactionProbe {
  readonly read: Effect.Effect<{
    readonly db: DrizzleDb;
    readonly requestContext: RequestContext | null;
  }>;
}

const TransactionProbe = Context.GenericTag<TransactionProbe>(
  '@stocket/test/TransactionProbe',
);

const isExpectedTransactionError = (
  cause: unknown,
): cause is ExpectedTransactionError =>
  cause instanceof ExpectedTransactionError;

const mapUnexpectedError = (cause: unknown) =>
  new MappedTransactionError({ cause });

const makeRequestContext = (): RequestContext => ({
  requestId: '00000000-0000-4000-8000-000000000099',
  path: '/api/v1/test',
  method: 'POST',
  ip: null,
  locale: 'en',
  tenantId: '00000000-0000-4000-a000-000000000001',
  tenantName: 'Tenant A',
  tenantSlug: 'tenant-a',
});

const makeTransactionalDb = (txDb: unknown = {}) => {
  let rollbackCause: unknown;
  let transactionCalls = 0;
  const transaction = async <A>(
    callback: (tx: unknown) => Promise<A>,
  ): Promise<A> => {
    transactionCalls += 1;
    try {
      return await callback(txDb);
    } catch (error) {
      rollbackCause = error;
      throw error;
    }
  };

  return {
    db: { transaction },
    getRollbackCause: () => rollbackCause,
    getTransactionCalls: () => transactionCalls,
  };
};

describe('makeDrizzleTransactionRunner', () => {
  it('preserves typed failures while throwing them through the transaction callback', async () => {
    const expected = new ExpectedTransactionError({ reason: 'domain' });
    const { db, getRollbackCause, getTransactionCalls } =
      makeTransactionalDb();
    const runner = makeDrizzleTransactionRunner(db);

    const error = await Effect.runPromise(
      Effect.flip(
        runner.run(Effect.fail(expected), {
          layer: Layer.empty,
          isExpectedError: isExpectedTransactionError,
          mapUnexpectedError,
        }),
      ),
    );

    expect(error).toBe(expected);
    expect(getRollbackCause()).toBe(expected);
    expect(getTransactionCalls()).toBe(1);
  });

  it('maps unexpected transaction failures at the boundary', async () => {
    const cause = new Error('connection lost');
    let transactionCalls = 0;
    const db = {
      transaction: async <A>(
        _callback: (tx: unknown) => Promise<A>,
      ): Promise<A> => {
        transactionCalls += 1;
        throw cause;
      },
    };
    const runner = makeDrizzleTransactionRunner(db);

    const error = await Effect.runPromise(
      Effect.flip(
        runner.run(Effect.succeed('ok'), {
          layer: Layer.empty,
          isExpectedError: isExpectedTransactionError,
          mapUnexpectedError,
        }),
      ),
    );

    expect(error).toMatchObject({
      _tag: 'MappedTransactionError',
      cause,
    });
    expect(transactionCalls).toBe(1);
  });

  it('wraps defects before mapping them as unexpected transaction failures', async () => {
    const { db } = makeTransactionalDb();
    const runner = makeDrizzleTransactionRunner(db);
    const defect = new Error('boom');
    let mappedCause: unknown;

    const error = await Effect.runPromise(
      Effect.flip(
        runner.run(Effect.die(defect), {
          layer: Layer.empty,
          isExpectedError: isExpectedTransactionError,
          mapUnexpectedError: (cause) => {
            mappedCause = cause;
            return mapUnexpectedError(cause);
          },
        }),
      ),
    );

    expect(error._tag).toBe('MappedTransactionError');
    expect(mappedCause).toBeInstanceOf(TransactionDefect);
    if (!(mappedCause instanceof TransactionDefect)) {
      throw new Error('Expected transaction defect wrapper');
    }
    expect(mappedCause.message).toContain('boom');
  });

  it('rebuilds services with the transaction database and current request context', async () => {
    const txDb = { marker: 'tx-db' };
    const { db } = makeTransactionalDb(txDb);
    const runner = makeDrizzleTransactionRunner(db);
    const requestContext = makeRequestContext();
    const probeLayer = Layer.effect(
      TransactionProbe,
      Effect.gen(function* () {
        const transactionDb = yield* DrizzleDatabase;
        const context = yield* Effect.serviceOption(CurrentRequestContext);

        return {
          read: Effect.succeed({
            db: transactionDb,
            requestContext: Option.getOrNull(context),
          }),
        };
      }),
    );

    const result = await Effect.runPromise(
      runner
        .run(Effect.flatMap(TransactionProbe, (probe) => probe.read), {
          layer: probeLayer,
          isExpectedError: isExpectedTransactionError,
          mapUnexpectedError,
        })
        .pipe(
          Effect.provideService(CurrentRequestContext, requestContext),
        ),
    );

    expect(result.db).toBe(txDb);
    expect(result.requestContext).toBe(requestContext);
  });
});
