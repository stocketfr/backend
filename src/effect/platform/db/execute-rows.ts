import type { SQL } from 'drizzle-orm';
import { Schema } from 'effect';

interface ExecuteRowsDatabase {
  readonly execute: (query: SQL) => unknown;
}

type ExecuteResultWithRows = {
  readonly rows?: ReadonlyArray<unknown>;
};

const hasRowsProperty = (value: unknown): value is ExecuteResultWithRows =>
  value !== null && typeof value === 'object' && 'rows' in value;

export const rowsFromExecuteResult = (
  result: unknown,
): ReadonlyArray<unknown> => {
  if (Array.isArray(result)) {
    return result;
  }

  if (hasRowsProperty(result)) {
    return result.rows ?? [];
  }

  return [];
};

export const executeRows = async <A, I>(
  db: ExecuteRowsDatabase,
  query: SQL,
  rowSchema: Schema.Schema<A, I, never>,
): Promise<A[]> =>
  Array.from(
    Schema.decodeUnknownSync(Schema.Array(rowSchema))(
      rowsFromExecuteResult(await db.execute(query)),
    ),
  );
