/**
 * Shared test harness for `stock-movements/router.spec.ts`.
 *
 * Mirrors `suppliers/__fixtures__/router-harness.ts`: stubs
 * `PermissionProvider`, `AuditLogWriter`, and the module service, and
 * wraps the router with `catchAllCause(respondCause)` so guard/session
 * failures surface as 401/403 instead of 500.
 */
import { type Effect } from 'effect';
import type { Permission, Resource } from '@stocket/types/auth';
import type { AuditWriteParams } from '../../../platform/audit';
import {
  makeRouterServiceLayer,
  makeRouterTestHarness,
} from '../../../testing/router-harness';
import { stockMovementsRouter } from '../router';
import { StockMovementsService } from '../service';

export interface StockMovementsRouterHarnessOptions {
  readonly service: Record<string, unknown>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  readonly auditLog?: (
    params: AuditWriteParams,
  ) => Effect.Effect<void, never, unknown>;
}

export interface StockMovementsRouterHarness {
  readonly handler: (request: Request) => Promise<Response>;
  readonly auditSpy: (
    params: AuditWriteParams,
  ) => Effect.Effect<void, never, unknown>;
}

export const makeStockMovementsRouterHarness = (
  opts: StockMovementsRouterHarnessOptions,
): StockMovementsRouterHarness => {
  return makeRouterTestHarness({
    router: stockMovementsRouter,
    layers: [makeRouterServiceLayer(StockMovementsService, opts.service)],
    permissions: opts.permissions,
    auditLog: opts.auditLog,
  });
};
