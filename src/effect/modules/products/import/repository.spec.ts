import { describe, expect, it } from '@effect/vitest';
import { Cause, Effect, Exit, FiberId, Option } from 'effect';
import { ProductsInfrastructureError } from '../products.errors';
import {
  ProductImportTransactionDefect,
  restoreProductImportTransactionError,
  runProductImportEffectAsPromise,
} from './repository';

const infrastructureFailure = () =>
  new ProductsInfrastructureError({
    action: 'test product import transaction',
    messageKey: 'products.repositoryFailed',
  });

const rejectedTransaction = async <A>(
  effect: Effect.Effect<A, ProductsInfrastructureError>,
) => {
  try {
    await runProductImportEffectAsPromise(effect);
  } catch (error) {
    if (error instanceof ProductImportTransactionDefect) return error;
    throw error;
  }
  throw new Error('Expected transaction effect to reject');
};

const restoredCause = async (error: ProductImportTransactionDefect) => {
  const exit = await Effect.runPromiseExit(
    restoreProductImportTransactionError(error),
  );
  if (Exit.isSuccess(exit)) throw new Error('Expected restored effect to fail');
  return exit.cause;
};

describe('product import transaction Effect bridge', () => {
  it('converts a pure typed failure into a recoverable transaction failure', async () => {
    const failure = infrastructureFailure();
    const rejected = await rejectedTransaction(Effect.fail(failure));

    expect(rejected.failure).toBe(failure);
    expect(rejected.nonFailureCause).toBeNull();
    const cause = await restoredCause(rejected);
    expect(Cause.failureOption(cause)).toEqual(Option.some(failure));
    expect(Cause.isDie(cause)).toBe(false);
    expect(Cause.isInterrupted(cause)).toBe(false);
  });

  it('preserves Effect defects instead of converting them into row errors', async () => {
    const defect = new Error('unexpected row defect');
    const rejected = await rejectedTransaction(Effect.die(defect));

    expect(rejected.failure).toBeNull();
    expect(rejected.nonFailureCause).not.toBeNull();
    const cause = await restoredCause(rejected);
    expect(Cause.isDie(cause)).toBe(true);
    expect(Cause.defects(cause)).toContain(defect);
  });

  it('preserves a mixed typed failure and defect without discarding either', async () => {
    const failure = infrastructureFailure();
    const defect = new Error('mixed row defect');
    const mixedCause = Cause.parallel(Cause.fail(failure), Cause.die(defect));
    const rejected = await rejectedTransaction(Effect.failCause(mixedCause));

    expect(rejected.failure).toBeNull();
    const cause = await restoredCause(rejected);
    expect(Cause.failureOption(cause)).toEqual(Option.some(failure));
    expect(Cause.defects(cause)).toContain(defect);
  });

  it('preserves interruption causes across the Promise boundary', async () => {
    const interruptCause = Cause.interrupt(FiberId.none);
    const rejected = await rejectedTransaction(
      Effect.failCause(interruptCause),
    );

    expect(rejected.failure).toBeNull();
    const cause = await restoredCause(rejected);
    expect(Cause.isInterrupted(cause)).toBe(true);
  });
});
