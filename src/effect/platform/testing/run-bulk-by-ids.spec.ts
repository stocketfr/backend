import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { runBulkByIds } from '../effect/run-bulk-by-ids';

describe('runBulkByIds', () => {
  it('acts on existing ids and reports ids returned by the action', async () => {
    const find = vi.fn((ids: readonly string[]) =>
      Effect.succeed(
        ids.filter((id) => id !== 'missing').map((id) => ({ id })),
      ),
    );
    const act = vi.fn(() => Effect.succeed(['b']));

    const result = await Effect.runPromise(
      runBulkByIds({
        ids: ['a', 'missing', 'b'],
        find,
        act,
        entityName: 'Product',
      }),
    );

    expect(find).toHaveBeenCalledWith(['a', 'missing', 'b']);
    expect(act).toHaveBeenCalledWith(['a', 'b']);
    expect(result).toEqual({
      success_count: 1,
      failure_count: 1,
      succeeded: ['b'],
      failures: [{ id: 'missing', error: 'Product not found' }],
    });
  });

  it('does not query or act for an empty id list', async () => {
    const find = vi.fn(() => Effect.succeed([]));
    const act = vi.fn(() => Effect.succeed([]));

    const result = await Effect.runPromise(
      runBulkByIds({ ids: [], find, act }),
    );

    expect(find).not.toHaveBeenCalled();
    expect(act).not.toHaveBeenCalled();
    expect(result).toEqual({
      success_count: 0,
      failure_count: 0,
      succeeded: [],
      failures: [],
    });
  });

  it('can override not-found failure text', async () => {
    const result = await Effect.runPromise(
      runBulkByIds({
        ids: ['missing'],
        find: () => Effect.succeed([]),
        act: () => Effect.succeed([]),
        notFoundError: 'Product not found or not deleted',
      }),
    );

    expect(result.failures).toEqual([
      { id: 'missing', error: 'Product not found or not deleted' },
    ]);
  });
});
