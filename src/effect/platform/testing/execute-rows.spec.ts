import { describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { Schema } from 'effect';
import { executeRows, rowsFromExecuteResult } from '../db/execute-rows';

const IdRow = Schema.Struct({ id: Schema.String });

describe('rowsFromExecuteResult', () => {
  it('reads node-postgres style rows', () => {
    expect(rowsFromExecuteResult({ rows: [{ id: 'a' }] })).toEqual([{ id: 'a' }]);
  });

  it('reads array-shaped execute results', () => {
    expect(rowsFromExecuteResult([{ id: 'a' }])).toEqual([{ id: 'a' }]);
  });

  it('returns an empty array for unknown shapes', () => {
    expect(rowsFromExecuteResult({ rowCount: 1 })).toEqual([]);
  });
});

describe('executeRows', () => {
  it('decodes rows with the provided schema', async () => {
    const db = {
      execute: vi.fn(async () => ({ rows: [{ id: 'a' }] })),
    };

    await expect(executeRows(db, sql`SELECT 'a' AS id`, IdRow)).resolves.toEqual(
      [{ id: 'a' }],
    );
  });

  it('rejects malformed rows instead of trusting the caller', async () => {
    const db = {
      execute: vi.fn(async () => ({ rows: [{ id: 1 }] })),
    };

    await expect(executeRows(db, sql`SELECT 1 AS id`, IdRow)).rejects.toThrow();
  });
});
