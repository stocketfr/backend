import { HttpServer } from '@effect/platform';
import {
  NodeFileSystem,
  NodeHttpServer,
  NodePath,
  NodeRuntime,
} from '@effect/platform-node';
import { createServer } from 'node:http';
import { Effect, Layer } from 'effect';
import { buildHttpApp } from './http/app';
import { AuditLogsService } from './modules/audit-logs/service';
import { AreasService } from './modules/areas/service';
import { AuthService } from './modules/auth/service';
import { BrandingService } from './modules/branding/service';
import { CategoriesService } from './modules/categories/service';
import { ClientsService } from './modules/clients/service';
import { HealthService } from './modules/health/service';
import { InventoryService } from './modules/inventory/service';
import { LocationsService } from './modules/locations/service';
import { NotificationsService } from './modules/notifications/service';
import { OrdersService } from './modules/orders/service';
import { PhotosService } from './modules/photos/service';
import { ProductImportService } from './modules/products/import/service';
import { ProductsService } from './modules/products/service';
import type { RolesInfrastructureError } from './modules/roles/roles.errors';
import { RolesService } from './modules/roles/service';
import { SuperAdminService } from './modules/superadmin/service';
import { PermissionProvider } from './platform/auth/permission-provider';
import { StockMovementsService } from './modules/stock-movements/service';
import { SuppliersService } from './modules/suppliers/service';
import { UsersService } from './modules/users/service';
import { auditLayer } from './platform/audit/index';
import { BetterAuth, betterAuthLayer } from './platform/auth/better-auth';
import { runtimeLoggingLayer } from './platform/observability/console-logging';
import {
  DrizzleDatabase,
  DrizzleInitializationError,
  drizzleLayer,
} from './platform/db/drizzle';
import { repairBetterAuthSchema } from './platform/db/better-auth-schema-repair';
import { applyCommittedSqlMigrations } from './platform/db/committed-sql-migrations';
import { normalizeDevelopmentTenantDomains } from './platform/db/dev-tenant-domain-cleanup';
import {
  prepareFreshDatabaseDataMigrations,
  runFreshDatabaseDataMigrations,
} from './platform/db/fresh-database-data-migrations';
import {
  type StorageConfigurationError,
  storageLayer,
} from './platform/storage';
import { TracingLive } from './platform/observability/tracing';
import { readRequiredEnv } from '../config/env.utils';

const VALID_NODE_ENVS = ['development', 'staging', 'production'] as const;
const nodeEnv = readRequiredEnv('NODE_ENV');
if (!VALID_NODE_ENVS.includes(nodeEnv as (typeof VALID_NODE_ENVS)[number])) {
  throw new Error(
    `Invalid NODE_ENV="${nodeEnv}". Must be one of: ${VALID_NODE_ENVS.join(', ')}`,
  );
}
process.env.NODE_ENV = nodeEnv;
const isProduction = nodeEnv === 'production';
const isDevelopment = nodeEnv === 'development';

const port = Number(readRequiredEnv('PORT'));
if (!Number.isInteger(port) || port <= 0) {
  throw new Error('PORT must be a positive integer');
}

const platformLayer = Layer.mergeAll(
  drizzleLayer,
  betterAuthLayer,
  storageLayer,
);
const withPlatform = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  layer.pipe(Layer.provide(platformLayer));

const rolesApplicationLayer = withPlatform(RolesService.Default);
const permissionProviderLayer = Layer.effect(
  PermissionProvider,
  Effect.map(RolesService, ({ getPermissionsForUser }) => ({
    getPermissionsForUser,
  })),
).pipe(Layer.provide(rolesApplicationLayer));
const authApplicationLayer = AuthService.Default.pipe(
  Layer.provide(rolesApplicationLayer),
);
const usersApplicationLayer = UsersService.Default.pipe(
  Layer.provide(Layer.mergeAll(platformLayer, rolesApplicationLayer)),
);
const superAdminApplicationLayer = SuperAdminService.Default.pipe(
  Layer.provide(platformLayer),
);

const shouldRunStartupMigrations = () =>
  !isProduction || process.env.RUN_BETTER_AUTH_MIGRATIONS === 'true';

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

const runDevelopmentTenantDomainCleanup = Effect.gen(function* () {
  if (!isDevelopment) {
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

const startupMigrations = Effect.gen(function* () {
  if (!shouldRunStartupMigrations()) {
    return;
  }

  const { freshSchemaCreated } = yield* runCommittedSqlMigrations;
  yield* prepareFreshDatabaseDataMigrationsEffect(freshSchemaCreated);
  yield* runBetterAuthMigrations;
  yield* runDevelopmentTenantDomainCleanup;
  yield* runFreshDatabaseDataMigrationsEffect(freshSchemaCreated);
});

const notificationsApplicationLayer = withPlatform(
  NotificationsService.Default,
);

const foundationalServicesLayer = Layer.mergeAll(
  withPlatform(HealthService.Default),
  withPlatform(AuditLogsService.Default),
  withPlatform(BrandingService.Default),
  withPlatform(LocationsService.Default),
  withPlatform(CategoriesService.Default),
  withPlatform(ClientsService.Default),
  withPlatform(SuppliersService.Default),
  withPlatform(PhotosService.Default),
  notificationsApplicationLayer,
);

const locationsApplicationLayer = withPlatform(LocationsService.Default);
const categoriesApplicationLayer = withPlatform(CategoriesService.Default);
const areasApplicationLayer = AreasService.Default.pipe(
  Layer.provide(Layer.mergeAll(platformLayer, locationsApplicationLayer)),
);
const clientsApplicationLayer = withPlatform(ClientsService.Default);
const productsApplicationLayer = ProductsService.Default.pipe(
  Layer.provide(Layer.mergeAll(platformLayer, categoriesApplicationLayer)),
);
const productImportApplicationLayer = ProductImportService.Default.pipe(
  Layer.provide(platformLayer),
);
const workflowServicesLayer = Layer.mergeAll(
  StockMovementsService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        platformLayer,
        productsApplicationLayer,
        locationsApplicationLayer,
      ),
    ),
  ),
  InventoryService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        platformLayer,
        productsApplicationLayer,
        locationsApplicationLayer,
        areasApplicationLayer,
      ),
    ),
  ),
  OrdersService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        platformLayer,
        clientsApplicationLayer,
        productsApplicationLayer,
      ),
    ),
  ),
);

const startupLayer = Layer.mergeAll(
  auditLayer.pipe(Layer.provide(platformLayer)),
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* startupMigrations;
      const rolesService = yield* RolesService;
      yield* rolesService.seed();
      // Launch the periodic notifications scan only after migrations have
      // created the tables it reads/writes. forkDaemon detaches it for the
      // app lifetime; runScan logs and swallows its own errors.
      const notifications = yield* NotificationsService;
      yield* Effect.forkDaemon(
        Effect.repeat(notifications.runScan, notifications.scanInterval),
      );
    }),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        platformLayer,
        rolesApplicationLayer,
        notificationsApplicationLayer,
      ),
    ),
  ),
);

const applicationLayer = Layer.mergeAll(
  platformLayer,
  NodeFileSystem.layer,
  NodePath.layer,
  TracingLive,
  startupLayer,
  foundationalServicesLayer,
  rolesApplicationLayer,
  permissionProviderLayer,
  authApplicationLayer,
  usersApplicationLayer,
  superAdminApplicationLayer,
  areasApplicationLayer,
  productsApplicationLayer,
  productImportApplicationLayer,
  workflowServicesLayer,
);

const serverLayer = Layer.unwrapEffect(
  buildHttpApp.pipe(
    Effect.map((app) =>
      HttpServer.serve(app).pipe(
        Layer.provide(NodeHttpServer.layer(createServer, { port })),
      ),
    ),
  ),
);

NodeRuntime.runMain(
  Layer.launch(serverLayer).pipe(
    Effect.provide(applicationLayer),
    Effect.provide(runtimeLoggingLayer),
  ) as Effect.Effect<
    never,
    | RolesInfrastructureError
    | DrizzleInitializationError
    | StorageConfigurationError,
    never
  >,
);
