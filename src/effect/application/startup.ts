import { Effect, Layer } from 'effect';
import { applyCommittedSqlMigrations } from '../platform/db/committed-sql-migrations';
import { repairBetterAuthSchema } from '../platform/db/better-auth-schema-repair';
import { normalizeDevelopmentTenantDomains } from '../platform/db/dev-tenant-domain-cleanup';
import {
  prepareFreshDatabaseDataMigrations,
  runFreshDatabaseDataMigrations,
} from '../platform/db/fresh-database-data-migrations';
import {
  DrizzleDatabase,
  DrizzleInitializationError,
} from '../platform/db/drizzle';
import { BetterAuth } from '../platform/auth/better-auth';
import { RolesService } from '../modules/roles/service';
import { NotificationsService } from '../modules/notifications/service';
import { auditLayer } from '../platform/audit/index';

export const APPLICATION_NODE_ENVS = [
  'development',
  'staging',
  'production',
] as const;

export type ApplicationNodeEnv = (typeof APPLICATION_NODE_ENVS)[number];

const applicationNodeEnvSet: ReadonlySet<string> = new Set(
  APPLICATION_NODE_ENVS,
);

export const isApplicationNodeEnv = (
  value: string,
): value is ApplicationNodeEnv => applicationNodeEnvSet.has(value);

export interface StartupOptions {
  readonly nodeEnv: ApplicationNodeEnv;
  readonly runBetterAuthMigrations: boolean;
}

export const shouldRunStartupMigrations = ({
  nodeEnv,
  runBetterAuthMigrations,
}: StartupOptions): boolean =>
  nodeEnv !== 'production' || runBetterAuthMigrations;

const runCommittedSqlMigrations = Effect.gen(function* () {
  const db = yield* DrizzleDatabase;
  return yield* Effect.tryPromise({
    try: async () => applyCommittedSqlMigrations(db),
    catch: (cause) =>
      new DrizzleInitializationError({
        messageKey: 'drizzle.migrationsFailed',
        cause,
      }),
  });
});

const runFreshDatabaseDataMigrationsEffect = (freshSchemaCreated: boolean) =>
  Effect.gen(function* () {
    const db = yield* DrizzleDatabase;
    yield* Effect.tryPromise({
      try: async () =>
        runFreshDatabaseDataMigrations(db, { freshSchemaCreated }),
      catch: (cause) =>
        new DrizzleInitializationError({
          messageKey: 'drizzle.migrationsFailed',
          cause,
        }),
    });
  });

const prepareFreshDatabaseDataMigrationsEffect = (
  freshSchemaCreated: boolean,
) =>
  Effect.gen(function* () {
    const db = yield* DrizzleDatabase;
    yield* Effect.tryPromise({
      try: async () =>
        prepareFreshDatabaseDataMigrations(db, { freshSchemaCreated }),
      catch: (cause) =>
        new DrizzleInitializationError({
          messageKey: 'drizzle.migrationsFailed',
          cause,
        }),
    });
  });

const runBetterAuthMigrations = Effect.gen(function* () {
  const betterAuth = yield* BetterAuth;
  const db = yield* DrizzleDatabase;
  yield* Effect.tryPromise({
    try: async () => {
      const ctx = await betterAuth.auth.$context;
      await ctx.runMigrations();
      await repairBetterAuthSchema(db);
    },
    catch: (cause) =>
      new DrizzleInitializationError({
        messageKey: 'drizzle.migrationsFailed',
        cause,
      }),
  });
});

const makeDevelopmentTenantDomainCleanup = (nodeEnv: ApplicationNodeEnv) =>
  Effect.gen(function* () {
    if (nodeEnv !== 'development') {
      return;
    }

    const db = yield* DrizzleDatabase;
    yield* Effect.tryPromise({
      try: async () => {
        await normalizeDevelopmentTenantDomains(db);
      },
      catch: (cause) =>
        new DrizzleInitializationError({
          messageKey: 'drizzle.migrationsFailed',
          cause,
        }),
    });
  });

const makeStartupMigrations = (options: StartupOptions) =>
  Effect.gen(function* () {
    if (!shouldRunStartupMigrations(options)) {
      return;
    }

    const { freshSchemaCreated } = yield* runCommittedSqlMigrations;
    yield* prepareFreshDatabaseDataMigrationsEffect(freshSchemaCreated);
    yield* runBetterAuthMigrations;
    yield* makeDevelopmentTenantDomainCleanup(options.nodeEnv);
    yield* runFreshDatabaseDataMigrationsEffect(freshSchemaCreated);
  });

const launchNotificationsScan = Effect.gen(function* () {
  const notifications = yield* NotificationsService;
  yield* Effect.forkDaemon(
    Effect.repeat(notifications.runScan, notifications.scanInterval),
  );
});

const makeStartupEffect = (options: StartupOptions) =>
  Effect.gen(function* () {
    yield* makeStartupMigrations(options);
    const rolesService = yield* RolesService;
    yield* rolesService.seed();
    yield* launchNotificationsScan;
  });

export const makeStartupLayer = (options: StartupOptions) =>
  Layer.mergeAll(auditLayer, Layer.effectDiscard(makeStartupEffect(options)));
