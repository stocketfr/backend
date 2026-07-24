import { NodeRuntime } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { closeAuthDatabase } from '../auth';
import { runPreDeployMigration } from './application/pre-deploy-migration';
import { RolesService } from './modules/roles/service';
import { betterAuthLayer } from './platform/auth/better-auth';
import { migrationDrizzleLayer } from './platform/db/drizzle';
import { runtimeLoggingLayer } from './platform/observability/console-logging';

const rolesLayer = RolesService.Default.pipe(
  Layer.provide(migrationDrizzleLayer),
);

const migrationDependencies = Layer.mergeAll(
  migrationDrizzleLayer,
  betterAuthLayer,
  rolesLayer,
);

const closeAuthDatabaseEffect = Effect.tryPromise({
  try: closeAuthDatabase,
  catch: () => undefined,
}).pipe(Effect.ignore);

const main = runPreDeployMigration.pipe(
  Effect.provide(migrationDependencies),
  Effect.provide(runtimeLoggingLayer),
  Effect.ensuring(closeAuthDatabaseEffect),
);

NodeRuntime.runMain(main);
