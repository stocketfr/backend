/**
 * Router-test harness for `ordersRouter`.
 *
 * Builds a web handler with stubbed `OrdersService`, `PermissionProvider`,
 * `BetterAuth` (session), and `AuditLogWriter` layers. The top-level
 * `HttpRouter.catchAllCause(respondCause)` is re-applied so guard/decode
 * failures map to 401/403/400 instead of escaping as 500.
 */
import { Effect } from 'effect';
import type { Permission, Resource } from '@stocket/types/auth';
import { FeatureKey } from '@stocket/types/features';
import type { AuditWriteParams } from '../../../platform/audit/index';
import {
  type makeFakeSession,
  makeRouterServiceLayer,
  makeRouterTestHarness,
} from '../../../testing/router-harness';
import { ordersRouter } from '../router';
import { FeatureNotEnabled } from '../../features/features.errors';
import { FeaturesService } from '../../features/service';
import { OrdersService } from '../service';

export { FAKE_USER_ID, makeFakeSession } from '../../../testing/router-harness';

export interface OrdersRouterHarnessOptions {
  readonly service: Record<string, unknown>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  readonly session?: ReturnType<typeof makeFakeSession> | null;
  readonly auditLog?: (
    params: AuditWriteParams,
  ) => Effect.Effect<void, never, unknown>;
  readonly ordersFeatureEnabled?: boolean;
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
  const featuresLayer = makeRouterServiceLayer(FeaturesService, {
    requireFeature: () =>
      opts.ordersFeatureEnabled === false
        ? Effect.fail(
            new FeatureNotEnabled({
              featureKey: FeatureKey.ORDERS,
              messageKey: 'features.notEnabled',
            }),
          )
        : Effect.void,
  });

  return makeRouterTestHarness({
    router: ordersRouter,
    layers: [makeRouterServiceLayer(OrdersService, opts.service), featuresLayer],
    permissions: opts.permissions,
    roleNames: [],
    session: opts.session,
    provideBetterAuth: true,
    auditLog: opts.auditLog,
  });
};
