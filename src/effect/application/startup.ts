import { Effect, Layer } from 'effect';
import { normalizeDevelopmentTenantDomains } from '../platform/db/dev-tenant-domain-cleanup';
import {
  DrizzleDatabase,
  DrizzleInitializationError,
} from '../platform/db/drizzle';
import { NotificationsService } from '../modules/notifications/service';
import { auditLayer } from '../platform/audit/index';
import { makeTryAsync } from '../platform/effect/try-async';
import type { ApplicationNodeEnv } from './environment';

export interface StartupOptions {
  readonly nodeEnv: ApplicationNodeEnv;
}

const tryStartupMaintenance = makeTryAsync(
  (_action, cause) =>
    new DrizzleInitializationError({
      messageKey: 'drizzle.startupMaintenanceFailed',
      cause,
    }),
);

const makeDevelopmentTenantDomainCleanup = (nodeEnv: ApplicationNodeEnv) =>
  Effect.gen(function* () {
    if (nodeEnv !== 'development') {
      return;
    }

    const db = yield* DrizzleDatabase;
    yield* tryStartupMaintenance('normalize development tenant domains', () =>
      normalizeDevelopmentTenantDomains(db),
    );
  });

const launchNotificationsScan = Effect.gen(function* () {
  const notifications = yield* NotificationsService;
  yield* Effect.forkScoped(
    Effect.repeat(notifications.runScan, notifications.scanInterval),
  );
});

const makeStartupEffect = (options: StartupOptions) =>
  Effect.gen(function* () {
    yield* makeDevelopmentTenantDomainCleanup(options.nodeEnv);
    yield* launchNotificationsScan;
  });

export const makeStartupLayer = (options: StartupOptions) =>
  Layer.mergeAll(auditLayer, Layer.scopedDiscard(makeStartupEffect(options)));
