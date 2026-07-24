import { Effect } from 'effect';
import pg from 'pg';
import {
  DrizzleInitializationError,
  getDatabasePoolConfig,
} from './drizzle';

const MIGRATION_ADVISORY_LOCK_ID = '754002967000128';

interface MigrationLockHandle {
  readonly client: pg.Client;
  readonly lockLoss: Promise<never>;
  readonly onClientError: (error: Error) => void;
  readonly onClientEnd: () => void;
}

const lockFailure = (cause: unknown) =>
  new DrizzleInitializationError({
    cause,
    messageKey: 'drizzle.migrationLockFailed',
  });

const acquireMigrationLock = Effect.tryPromise({
  try: async (): Promise<MigrationLockHandle> => {
    const client = new pg.Client(getDatabasePoolConfig());
    let rejectLockLoss: (error: Error) => void = () => undefined;
    const lockLoss = new Promise<never>((_resolve, reject) => {
      rejectLockLoss = reject;
    });
    void lockLoss.catch(() => undefined);
    const onClientError = (error: Error) => rejectLockLoss(error);
    const onClientEnd = () =>
      rejectLockLoss(new Error('Database migration lock was lost'));
    client.on('error', onClientError);
    client.once('end', onClientEnd);
    try {
      await client.connect();
      await client.query('SELECT pg_advisory_lock($1::bigint)', [
        MIGRATION_ADVISORY_LOCK_ID,
      ]);
      return { client, lockLoss, onClientError, onClientEnd };
    } catch (error) {
      client.off('error', onClientError);
      client.off('end', onClientEnd);
      await client.end().catch(() => undefined);
      throw error;
    }
  },
  catch: lockFailure,
});

const awaitMigrationLockLoss = ({ lockLoss }: MigrationLockHandle) =>
  Effect.tryPromise({
    try: () => lockLoss,
    catch: lockFailure,
  });

const releaseMigrationLock = ({
  client,
  onClientError,
  onClientEnd,
}: MigrationLockHandle) =>
  Effect.tryPromise({
    try: async () => {
      try {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [
          MIGRATION_ADVISORY_LOCK_ID,
        ]);
      } finally {
        try {
          await client.end();
        } finally {
          client.off('error', onClientError);
          client.off('end', onClientEnd);
        }
      }
    },
    catch: () => undefined,
  }).pipe(Effect.ignore);

export const withDatabaseMigrationLock = <A, E, R>(
  migration: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | DrizzleInitializationError, R> =>
  Effect.acquireUseRelease(
    acquireMigrationLock,
    (lock) => Effect.raceFirst(migration, awaitMigrationLockLoss(lock)),
    releaseMigrationLock,
  );
