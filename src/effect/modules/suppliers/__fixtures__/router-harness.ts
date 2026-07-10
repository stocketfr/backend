/**
 * Shared test harness for `suppliers/router.spec.ts`.
 *
 * See `roles/__fixtures__/router-harness.ts` for the full rationale.
 * This file mirrors that helper for the `suppliersRouter` — same
 * stub strategy, different service tag and router.
 */
import type { Permission, Resource } from '@stocket/types/auth';
import {
  makeRouterServiceLayer,
  makeRouterTestHarness,
  type RouterAuditLog,
} from '../../../testing/router-harness';
import { suppliersRouter } from '../router';
import { SuppliersService } from '../service';

export interface SuppliersRouterHarnessOptions {
  readonly service: Record<string, unknown>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  readonly auditLog?: RouterAuditLog;
}

export interface SuppliersRouterHarness {
  readonly handler: (request: Request) => Promise<Response>;
  readonly auditSpy: RouterAuditLog;
}

export const makeSuppliersRouterHarness = (
  opts: SuppliersRouterHarnessOptions,
): SuppliersRouterHarness => {
  return makeRouterTestHarness({
    router: suppliersRouter,
    layers: [makeRouterServiceLayer(SuppliersService, opts.service)],
    permissions: opts.permissions,
    auditLog: opts.auditLog,
  });
};
