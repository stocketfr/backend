import { Effect } from 'effect';

interface EntityWithId {
  readonly id: string;
}

export const makeEnsureExistsById =
  <E, R, NotFound>(
    existsById: (id: string) => Effect.Effect<boolean, E, R>,
    makeNotFound: (id: string) => NotFound,
  ) =>
  (id: string): Effect.Effect<void, E | NotFound, R> =>
    existsById(id).pipe(
      Effect.filterOrFail(Boolean, () => makeNotFound(id)),
      Effect.asVoid,
    );

export const makeEnsureExistByIds =
  <Entity extends EntityWithId, E, R, NotFound>(
    findByIds: (
      ids: readonly string[],
    ) => Effect.Effect<readonly Entity[], E, R>,
    makeNotFound: (id: string) => NotFound,
  ) =>
  (ids: readonly string[]): Effect.Effect<void, E | NotFound, R> =>
    Effect.gen(function* () {
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length === 0) {
        return;
      }

      const entities = yield* findByIds(uniqueIds);
      const existingIds = new Set(entities.map((entity) => entity.id));
      const missingId = uniqueIds.find((id) => !existingIds.has(id));
      if (missingId) {
        return yield* Effect.fail(makeNotFound(missingId));
      }
    });
