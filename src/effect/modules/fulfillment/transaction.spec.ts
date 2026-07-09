import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { FulfillmentPickFailed, type FulfillmentError } from './errors';
import {
  FulfillmentTransactionDefect,
  runFulfillmentEffectAsPromise,
} from './transaction';

describe('runFulfillmentEffectAsPromise', () => {
  it('resolves successful effects', async () => {
    await expect(
      runFulfillmentEffectAsPromise(Effect.succeed('ok')),
    ).resolves.toBe('ok');
  });

  it('throws typed fulfillment failures as transaction defects', async () => {
    const failure = new FulfillmentPickFailed({
      orderItemId: 'order-item-1',
      messageKey: 'fulfillment.pickFailed',
    });
    let thrown: unknown;
    const failed: Effect.Effect<never, FulfillmentError, never> =
      Effect.fail(failure);

    try {
      await runFulfillmentEffectAsPromise(failed);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FulfillmentTransactionDefect);
    expect(thrown).toMatchObject({ failure });
  });
});
