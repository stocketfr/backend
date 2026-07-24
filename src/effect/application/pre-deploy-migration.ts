import { Effect } from 'effect';
import { BetterAuth } from '../platform/auth/better-auth';
import { repairBetterAuthSchema } from '../platform/db/better-auth-schema-repair';
import { applyCommittedSqlMigrations } from '../platform/db/committed-sql-migrations';
import {
  prepareFreshDatabaseDataMigrations,
  runFreshDatabaseDataMigrations,
} from '../platform/db/fresh-database-data-migrations';
import {
  DrizzleDatabase,
  DrizzleInitializationError,
} from '../platform/db/drizzle';
import { withDatabaseMigrationLock } from '../platform/db/migration-lock';
import { recordCurrentSchemaVersion } from '../platform/db/schema-version';
import { makeTryAsync } from '../platform/effect/try-async';
import { RolesService } from '../modules/roles/service';

const tryPreDeployMigration = makeTryAsync(
  (_action, cause) =>
    new DrizzleInitializationError({
      messageKey: 'drizzle.migrationsFailed',
      cause,
    }),
);

const runCommittedSqlMigrations = Effect.gen(function* () {
  const db = yield* DrizzleDatabase;
  return yield* tryPreDeployMigration(
    'apply committed SQL migrations',
    () => applyCommittedSqlMigrations(db),
  );
});

const prepareDataMigrations = (freshSchemaCreated: boolean) =>
  Effect.gen(function* () {
    const db = yield* DrizzleDatabase;
    yield* tryPreDeployMigration('prepare data migrations', () =>
      prepareFreshDatabaseDataMigrations(db, { freshSchemaCreated }),
    );
  });

const runBetterAuthMigrations = Effect.gen(function* () {
  const betterAuth = yield* BetterAuth;
  const db = yield* DrizzleDatabase;
  yield* tryPreDeployMigration('run Better Auth migrations', async () => {
    const ctx = await betterAuth.auth.$context;
    await ctx.runMigrations();
    await repairBetterAuthSchema(db);
  });
});

const runDataMigrations = (freshSchemaCreated: boolean) =>
  Effect.gen(function* () {
    const db = yield* DrizzleDatabase;
    yield* tryPreDeployMigration('run data migrations', () =>
      runFreshDatabaseDataMigrations(db, { freshSchemaCreated }),
    );
  });

const recordSchemaVersion = Effect.gen(function* () {
  const db = yield* DrizzleDatabase;
  yield* tryPreDeployMigration('record current schema version', () =>
    recordCurrentSchemaVersion(db),
  );
});

const migrationWorkflow = Effect.gen(function* () {
  const { freshSchemaCreated } = yield* runCommittedSqlMigrations;
  yield* prepareDataMigrations(freshSchemaCreated);
  yield* runBetterAuthMigrations;
  yield* runDataMigrations(freshSchemaCreated);
  const roles = yield* RolesService;
  yield* roles.seed();
  yield* recordSchemaVersion;
});

export const runPreDeployMigration = withDatabaseMigrationLock(
  migrationWorkflow,
);
