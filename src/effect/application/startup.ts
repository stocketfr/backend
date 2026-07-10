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
import { makeTryAsync } from '../platform/effect/try-async';
import type { ApplicationNodeEnv } from './environment';

export interface StartupOptions {
  readonly nodeEnv: ApplicationNodeEnv;
  readonly runBetterAuthMigrations: boolean;
}

export const shouldRunStartupMigrations = ({
  nodeEnv,
  runBetterAuthMigrations,
}: StartupOptions): boolean =>
  nodeEnv !== 'production' || runBetterAuthMigrations;

const tryStartupMigration = makeTryAsync(
  (_action, cause) =>
    new DrizzleInitializationError({
      messageKey: 'drizzle.migrationsFailed',
      cause,
    }),
);

const runCommittedSqlMigrations = Effect.gen(function* () {
  const db = yield* DrizzleDatabase;
  return yield* tryStartupMigration('apply committed SQL migrations', () =>
    applyCommittedSqlMigrations(db),
  );
});

const runFreshDatabaseDataMigrationsEffect = (freshSchemaCreated: boolean) =>
  Effect.gen(function* () {
    const db = yield* DrizzleDatabase;
    yield* tryStartupMigration('run fresh database data migrations', () =>
      runFreshDatabaseDataMigrations(db, { freshSchemaCreated }),
    );
  });

const prepareFreshDatabaseDataMigrationsEffect = (
  freshSchemaCreated: boolean,
) =>
  Effect.gen(function* () {
    const db = yield* DrizzleDatabase;
    yield* tryStartupMigration('prepare fresh database data migrations', () =>
      prepareFreshDatabaseDataMigrations(db, { freshSchemaCreated }),
    );
  });

const runBetterAuthMigrations = Effect.gen(function* () {
  const betterAuth = yield* BetterAuth;
  const db = yield* DrizzleDatabase;
  yield* tryStartupMigration('run Better Auth migrations', async () => {
    const ctx = await betterAuth.auth.$context;
    await ctx.runMigrations();
    await repairBetterAuthSchema(db);
  });
});

const makeDevelopmentTenantDomainCleanup = (nodeEnv: ApplicationNodeEnv) =>
  Effect.gen(function* () {
    if (nodeEnv !== 'development') {
      return;
    }

    const db = yield* DrizzleDatabase;
    yield* tryStartupMigration('normalize development tenant domains', () =>
      normalizeDevelopmentTenantDomains(db),
    );
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
  yield* Effect.forkScoped(
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
  Layer.mergeAll(auditLayer, Layer.scopedDiscard(makeStartupEffect(options)));
