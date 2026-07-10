import { Effect, Exit } from 'effect';
import { describe, expect, it, vi } from '@effect/vitest';
import { created, existing, retainOnCreate } from '../effect/create-or-reuse';

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
});
