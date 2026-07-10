import { Data, Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeReferenceEntityOperations } from '../reference-data-service';

class TestReferenceNotFound extends Data.TaggedError('TestReferenceNotFound')<{
  readonly id: string;
}> {}

const fail = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(Effect.flip(effect));

describe('makeReferenceEntityOperations', () => {
  it('exposes single-id existence validation using the same not-found mapping', async () => {
    const referenceEntity = makeReferenceEntityOperations({
      findById: (id: string) => Effect.succeed({ id }),
      deleteById: () => Effect.void,
      existsById: () => Effect.succeed(false),
      findByIds: () => Effect.succeed([]),
      makeNotFound: (id) => new TestReferenceNotFound({ id }),
      toResponse: (entity) => entity,
    });

    const error = await fail(
      referenceEntity.ensureExistsById('missing-reference'),
    );

    expect(error).toMatchObject({
      _tag: 'TestReferenceNotFound',
      id: 'missing-reference',
    });
  });

  it('exposes batched existence validation using the same not-found mapping', async () => {
    const referenceEntity = makeReferenceEntityOperations({
      findById: (id: string) => Effect.succeed({ id }),
      deleteById: () => Effect.void,
      existsById: () => Effect.succeed(true),
      findByIds: (ids: readonly string[]) =>
        Effect.succeed(
          ids.filter((id) => id !== 'missing-reference').map((id) => ({ id })),
        ),
      makeNotFound: (id) => new TestReferenceNotFound({ id }),
      toResponse: (entity) => entity,
    });

    const error = await fail(
      referenceEntity.ensureExistByIds([
        'existing-reference',
        'missing-reference',
      ]),
    );

    expect(error).toMatchObject({
      _tag: 'TestReferenceNotFound',
      id: 'missing-reference',
    });
  });
});
