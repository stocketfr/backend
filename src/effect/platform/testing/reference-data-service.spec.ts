import { Data, Effect } from 'effect';
import {
  makeReferenceEntityOperations,
  makeReferenceExistsValidator,
} from '../reference-data-service';

class TestReferenceNotFound extends Data.TaggedError('TestReferenceNotFound')<{
  readonly id: string;
}> {}

class TestLookupError extends Data.TaggedError('TestLookupError')<{
  readonly action: string;
}> {}

const run = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(effect);
const fail = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(Effect.flip(effect));

describe('makeReferenceExistsValidator', () => {
  it('succeeds when the referenced entity exists', async () => {
    const checkedIds: string[] = [];
    const ensureExists = makeReferenceExistsValidator({
      existsById: (id: string) =>
        Effect.sync(() => {
          checkedIds.push(id);
          return true;
        }),
      makeNotFound: (id) => new TestReferenceNotFound({ id }),
    });

    await run(ensureExists('reference-1'));

    expect(checkedIds).toEqual(['reference-1']);
  });

  it('fails with the caller-supplied not-found error when missing', async () => {
    const ensureExists = makeReferenceExistsValidator({
      existsById: () => Effect.succeed(false),
      makeNotFound: (id) => new TestReferenceNotFound({ id }),
    });

    const error = await fail(ensureExists('missing-reference'));

    expect(error).toMatchObject({
      _tag: 'TestReferenceNotFound',
      id: 'missing-reference',
    });
  });

  it('preserves lookup errors from the underlying check', async () => {
    const lookupError = new TestLookupError({ action: 'exists' });
    const ensureExists = makeReferenceExistsValidator({
      existsById: () => Effect.fail(lookupError),
      makeNotFound: (id) => new TestReferenceNotFound({ id }),
    });

    const error = await fail(ensureExists('reference-1'));

    expect(error).toBe(lookupError);
  });
});

describe('makeReferenceEntityOperations', () => {
  it('exposes existence validation using the same not-found mapping', async () => {
    const referenceEntity = makeReferenceEntityOperations({
      findById: (id: string) => Effect.succeed({ id }),
      deleteById: () => Effect.void,
      existsById: () => Effect.succeed(false),
      makeNotFound: (id) => new TestReferenceNotFound({ id }),
      toResponse: (entity) => entity,
    });

    const error = await fail(referenceEntity.ensureExists('missing-reference'));

    expect(error).toMatchObject({
      _tag: 'TestReferenceNotFound',
      id: 'missing-reference',
    });
  });
});
