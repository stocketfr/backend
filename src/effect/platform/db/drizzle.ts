import { Context, Effect, Layer } from 'effect';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import {
  getDatabaseUrl,
  getSSLConfig,
  getPoolMax,
  IDLE_TIMEOUT_MS,
} from '../../../config/db-connection.utils';
import * as schema from './schema';
import * as relations from './relations';
import { makeDrizzleLogger } from '../observability/console-logging';
import { InternalError } from '../effect/domain-errors';

export type DrizzleDb = NodePgDatabase<typeof schema & typeof relations>;

const __pool = Symbol('__pool');
type DrizzleDbWithPool = DrizzleDb & { [__pool]?: pg.Pool };

export class DrizzleInitializationError extends InternalError(
  'DrizzleInitializationError',
)<{
  readonly cause?: unknown;
}> {}

export const DrizzleDatabase = Context.GenericTag<DrizzleDb>(
  '@stocket/effect/platform/DrizzleDatabase',
);

function buildPoolConfig(): pg.PoolConfig {
  const connectionString = getDatabaseUrl();
  const ssl = getSSLConfig();
  const max = getPoolMax();

  return {
    connectionString,
    ssl: ssl || undefined,
    max,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  };
}

export const drizzleLayer = Layer.scoped(
  DrizzleDatabase,
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const pool = new pg.Pool(buildPoolConfig());
        // Verify connection
        const client = await pool.connect();
        client.release();

        const db = drizzle(pool, {
          schema: { ...schema, ...relations },
          logger: makeDrizzleLogger(),
        });

        // Attach pool for cleanup
        (db as DrizzleDbWithPool)[__pool] = pool;

        return db as DrizzleDb;
      },
      catch: (cause) =>
        new DrizzleInitializationError({
          cause,
          messageKey: 'drizzle.initializationFailed',
        }),
    }),
    (db) =>
      Effect.promise(async () => {
        const pool = (db as DrizzleDbWithPool)[__pool];
        if (pool) {
          await pool.end();
        }
      }),
  ),
);
