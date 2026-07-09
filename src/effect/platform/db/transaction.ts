import type { DrizzleDb } from './drizzle';

export const withDrizzleTransaction = <A>(
  db: DrizzleDb,
  run: (tx: DrizzleDb) => Promise<A>,
): Promise<A> =>
  db.transaction((tx) =>
    // Drizzle's PgTransaction is structurally compatible with the query
    // surface repositories use, but it is not exposed as NodePgDatabase.
    run(tx as unknown as DrizzleDb),
  );
