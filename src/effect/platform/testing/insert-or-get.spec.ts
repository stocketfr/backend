import { describe, expect, it, vi } from 'vitest';
import { insertOrGet } from '../db/insert-or-get';

describe('insertOrGet', () => {
  it('returns the inserted row without querying for an existing row', async () => {
    const getExisting = vi.fn<() => Promise<string | undefined>>();

    const result = await insertOrGet({
      insert: () => Promise.resolve('new-row'),
      getExisting,
      unresolvedConflictError: () => new Error('unresolved'),
    });

    expect(result).toEqual({ value: 'new-row', disposition: 'created' });
    expect(getExisting).not.toHaveBeenCalled();
  });

  it('returns the row that already owns the key after an insert conflict', async () => {
    const result = await insertOrGet({
      insert: () => Promise.resolve(undefined),
      getExisting: () => Promise.resolve('existing-row'),
      unresolvedConflictError: () => new Error('unresolved'),
    });

    expect(result).toEqual({ value: 'existing-row', disposition: 'existing' });
  });

  it('fails when the conflict cannot be resolved to an existing row', async () => {
    await expect(
      insertOrGet({
        insert: () => Promise.resolve(undefined),
        getExisting: () => Promise.resolve(undefined),
        unresolvedConflictError: () => new Error('unresolved'),
      }),
    ).rejects.toThrow('unresolved');
  });
});
