/**
 * Shared test harness for `users/router.spec.ts`.
 *
 * Similar to the other module harnesses, but note: the users router
 * uses `getRequestHeaders` and `Effect.provideService(BetterAuthHeaders, ...)`
 * on the service call. We don't wire a `BetterAuth` / `BetterAuthHeaders`
 * tag here because the mocked service never reads it — `provideService`
 * is a no-op when the underlying effect doesn't require the tag.
 */
import { type Effect } from 'effect';
import type { Permission, Resource } from '@stocket/types/auth';
import type { AuditWriteParams } from '../../../platform/audit';
import {
  makeRouterServiceLayer,
  makeRouterTestHarness,
} from '../../../testing/router-harness';
import { usersRouter } from '../router';
import { UsersService } from '../service';

export interface UsersRouterHarnessOptions {
  readonly service: Record<string, unknown>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  readonly auditLog?: (
    params: AuditWriteParams,
  ) => Effect.Effect<void, never, unknown>;
}

export interface UsersRouterHarness {
  readonly handler: (request: Request) => Promise<Response>;
  readonly auditSpy: (
    params: AuditWriteParams,
  ) => Effect.Effect<void, never, unknown>;
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
