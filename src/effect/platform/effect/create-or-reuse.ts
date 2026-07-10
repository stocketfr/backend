import { Effect, Exit } from 'effect';

export type CreateOrReuseDisposition = 'created' | 'existing';

export interface CreateOrReuseResult<A> {
  readonly value: A;
  readonly disposition: CreateOrReuseDisposition;
}

export const created = <A>(value: A): CreateOrReuseResult<A> => ({
  value,
  disposition: 'created',
});

export const existing = <A>(value: A): CreateOrReuseResult<A> => ({
  value,
  disposition: 'existing',
});

/**
 * Keeps a provisional resource only when its durable claim was created.
 *
 * Cleanup is best-effort so it cannot replace the claim failure or turn a
 * successfully reused value into a failure. This fits workflows that write an
 * object before atomically inserting a database row: the losing object is
 * removed when another caller already owns the idempotency key.
 *
 * The claim and cleanup decision form an uninterruptible critical section.
 * Promise-backed claims cannot be cancelled reliably, so allowing interruption
 * between a committed claim and its result would risk deleting the winning
 * provisional resource.
 */
export const retainOnCreate = <A, E, R, CleanupR>(
  claim: Effect.Effect<CreateOrReuseResult<A>, E, R>,
  cleanup: Effect.Effect<unknown, unknown, CleanupR>,
): Effect.Effect<A, E, R | CleanupR> =>
  Effect.uninterruptible(
    claim.pipe(
      Effect.onExit((exit) =>
        Exit.match(exit, {
          onFailure: () => Effect.ignore(cleanup),
          onSuccess: (result) =>
            result.disposition === 'existing'
              ? Effect.ignore(cleanup)
              : Effect.void,
        }),
      ),
      Effect.map((result) => result.value),
    ),
  );
