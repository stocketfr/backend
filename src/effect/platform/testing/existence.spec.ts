import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  makeEnsureExistByIds,
  makeEnsureExistsById,
} from '../effect/existence';

class MissingEntity {
  constructor(readonly id: string) {}
}

const fail = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(effect));

describe('existence helpers', () => {
  it('ensures a single id exists', async () => {
    const existsById = vi.fn((id: string) =>
      Effect.succeed(id === 'existing'),
    );
    const ensureExistsById = makeEnsureExistsById(
      existsById,
      (id) => new MissingEntity(id),
    );

    await Effect.runPromise(ensureExistsById('existing'));
    const error = await fail(ensureExistsById('missing'));

    expect(error).toBeInstanceOf(MissingEntity);
    expect(error.id).toBe('missing');
    expect(existsById).toHaveBeenCalledWith('existing');
  });

  it('ensures ids exist with one batched lookup and fails on the first missing id', async () => {
    const findByIds = vi.fn((ids: readonly string[]) =>
      Effect.succeed(ids.filter((id) => id !== 'missing').map((id) => ({ id }))),
    );
    const ensureExistByIds = makeEnsureExistByIds(
      findByIds,
      (id) => new MissingEntity(id),
    );

    await Effect.runPromise(ensureExistByIds(['a', 'b', 'a']));
    const error = await fail(ensureExistByIds(['a', 'missing', 'b']));

    expect(error).toBeInstanceOf(MissingEntity);
    expect(error.id).toBe('missing');
    expect(findByIds).toHaveBeenNthCalledWith(1, ['a', 'b']);
    expect(findByIds).toHaveBeenNthCalledWith(2, ['a', 'missing', 'b']);
  });
});
