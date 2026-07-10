/**
 * Shared test harness for `users/router.spec.ts`.
 *
 * Similar to the other module harnesses, but note: the users router
 * uses `getRequestHeaders` and `Effect.provideService(BetterAuthHeaders, ...)`
 * on the service call. We don't wire a `BetterAuth` / `BetterAuthHeaders`
 * tag here because the mocked service never reads it — `provideService`
 * is a no-op when the underlying effect doesn't require the tag.
 */
import type { Permission, Resource } from '@stocket/types/auth';
import {
  makeRouterServiceLayer,
  makeRouterTestHarness,
  type RouterAuditLog,
} from '../../../testing/router-harness';
import { usersRouter } from '../router';
import { UsersService } from '../service';

export interface UsersRouterHarnessOptions {
  readonly service: Record<string, unknown>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  readonly auditLog?: RouterAuditLog;
}

export interface UsersRouterHarness {
  readonly handler: (request: Request) => Promise<Response>;
  readonly auditSpy: RouterAuditLog;
}

export const makeUsersRouterHarness = (
  opts: UsersRouterHarnessOptions,
): UsersRouterHarness => {
  return makeRouterTestHarness({
    router: usersRouter,
    layers: [makeRouterServiceLayer(UsersService, opts.service)],
    permissions: opts.permissions,
    auditLog: opts.auditLog,
  });
};
