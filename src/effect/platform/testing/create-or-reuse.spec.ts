import { Deferred, Effect, Exit, Fiber } from 'effect';
import { describe, expect, it, vi } from '@effect/vitest';
import {
  created,
  existing,
  retainOnCreate,
  type CreateOrReuseResult,
} from '../effect/create-or-reuse';

describe('create-or-reuse', () => {
  it.effect(
    'retains the provisional resource when this call created the row',
    () =>
      Effect.gen(function* () {
        const cleanup = vi.fn(() => Effect.void);

        const value = yield* retainOnCreate(
          Effect.succeed(created('new-row')),
          Effect.suspend(cleanup),
        );

        expect(value).toBe('new-row');
        expect(cleanup).not.toHaveBeenCalled();
      }),
  );

  it.effect('cleans the provisional resource when an existing row won', () =>
    Effect.gen(function* () {
      const cleanup = vi.fn(() => Effect.void);

      const value = yield* retainOnCreate(
        Effect.succeed(existing('existing-row')),
        Effect.suspend(cleanup),
      );

      expect(value).toBe('existing-row');
      expect(cleanup).toHaveBeenCalledOnce();
    }),
  );

  it.effect('cleans after failure without replacing the original error', () =>
    Effect.gen(function* () {
      const cleanup = vi.fn(() => Effect.fail('cleanup-failed'));

      const error = yield* retainOnCreate(
        Effect.fail('claim-failed'),
        Effect.suspend(cleanup),
      ).pipe(Effect.flip);

      expect(error).toBe('claim-failed');
      expect(cleanup).toHaveBeenCalledOnce();
    }),
  );

  it.effect('cleans when the claim is interrupted', () =>
    Effect.gen(function* () {
      const cleanup = vi.fn(() => Effect.void);

      const exit = yield* retainOnCreate(
        Effect.interrupt,
        Effect.suspend(cleanup),
      ).pipe(Effect.exit);

      expect(Exit.isInterrupted(exit)).toBe(true);
      expect(cleanup).toHaveBeenCalledOnce();
    }),
  );

  it.effect(
    'waits for a non-cancellable claim before handling interruption',
    () =>
      Effect.gen(function* () {
        const claimStarted = yield* Deferred.make<void>();
        let resolveClaim: (
          result: CreateOrReuseResult<string>,
        ) => void = () => undefined;
        const claimPromise = new Promise<CreateOrReuseResult<string>>(
          (resolve) => {
            resolveClaim = resolve;
          },
        );
        const cleanup = vi.fn(() => Effect.void);
        const claim = Deferred.succeed(claimStarted, undefined).pipe(
          Effect.zipRight(Effect.promise(() => claimPromise)),
        );
        const fiber = yield* Effect.fork(
          retainOnCreate(claim, Effect.suspend(cleanup)),
        );

        yield* Deferred.await(claimStarted);
        const interruptFiber = yield* Effect.fork(Fiber.interrupt(fiber));
        yield* Effect.yieldNow();

        expect(cleanup).not.toHaveBeenCalled();

        resolveClaim(created('new-row'));
        const exit = yield* Fiber.join(interruptFiber);

        expect(Exit.isInterrupted(exit)).toBe(true);
        expect(cleanup).not.toHaveBeenCalled();
      }),
  );
});
