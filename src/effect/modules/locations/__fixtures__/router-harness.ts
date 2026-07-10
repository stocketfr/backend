/**
 * Router-test harness for `locationsRouter`.
 *
 * Builds a web handler with stubbed `LocationsService`, `PermissionProvider`,
 * `BetterAuth` (for session), and `AuditLogWriter` layers. The top-level
 * `HttpRouter.catchAllCause(respondCause)` is re-applied here to mirror
 * `buildHttpApp` — without it, guard failures escape as 500 instead of
 * 401/403.
 */
import type { Permission, Resource } from '@stocket/types/auth';
import {
  type makeFakeSession,
  makeRouterServiceLayer,
  makeRouterTestHarness,
  type RouterAuditLog,
} from '../../../testing/router-harness';
import { locationsRouter } from '../router';
import { LocationsService } from '../service';

export { FAKE_USER_ID, makeFakeSession } from '../../../testing/router-harness';

export interface LocationsRouterHarnessOptions {
  readonly service: Record<string, unknown>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  /** `null` → `requireSession` fails with `SessionUnauthorized`. */
  readonly session?: ReturnType<typeof makeFakeSession> | null;
  readonly auditLog?: RouterAuditLog;
}

export interface LocationsRouterHarness {
  readonly handler: (request: Request) => Promise<Response>;
  readonly auditSpy: RouterAuditLog;
}

export const makeLocationsRouterHarness = (
  opts: LocationsRouterHarnessOptions,
): LocationsRouterHarness => {
  return makeRouterTestHarness({
    router: locationsRouter,
    layers: [makeRouterServiceLayer(LocationsService, opts.service)],
    permissions: opts.permissions,
    roleNames: [],
    session: opts.session,
    provideBetterAuth: true,
    auditLog: opts.auditLog,
  });
};
