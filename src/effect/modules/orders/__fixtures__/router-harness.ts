/**
 * Router-test harness for `ordersRouter`.
 *
 * Builds a web handler with stubbed `OrdersService`, `PermissionProvider`,
 * `BetterAuth` (session), and `AuditLogWriter` layers. The top-level
 * `HttpRouter.catchAllCause(respondCause)` is re-applied so guard/decode
 * failures map to 401/403/400 instead of escaping as 500.
 */
import { type Effect } from 'effect';
import type { Permission, Resource } from '@stocket/types/auth';
import type { AuditWriteParams } from '../../../platform/audit/index';
import {
  type makeFakeSession,
  makeRouterServiceLayer,
  makeRouterTestHarness,
} from '../../../testing/router-harness';
import { ordersRouter } from '../router';
import { OrdersService } from '../service';

export { FAKE_USER_ID, makeFakeSession } from '../../../testing/router-harness';

export interface OrdersRouterHarnessOptions {
  readonly service: Record<string, unknown>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  readonly session?: ReturnType<typeof makeFakeSession> | null;
  readonly auditLog?: (
    params: AuditWriteParams,
  ) => Effect.Effect<void, never, unknown>;
}

export interface OrdersRouterHarness {
  readonly handler: (request: Request) => Promise<Response>;
  readonly auditSpy: (
    params: AuditWriteParams,
  ) => Effect.Effect<void, never, unknown>;
}

export const makeOrdersRouterHarness = (
  opts: OrdersRouterHarnessOptions,
): OrdersRouterHarness => {
  return makeRouterTestHarness({
    router: ordersRouter,
    layers: [makeRouterServiceLayer(OrdersService, opts.service)],
    permissions: opts.permissions,
    roleNames: [],
    session: opts.session,
    provideBetterAuth: true,
    auditLog: opts.auditLog,
  });
};
