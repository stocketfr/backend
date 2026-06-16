/**
 * Shared test harness for `roles/router.spec.ts`.
 *
 * Builds a web handler for `rolesRouter` with stubbed:
 *   - `PermissionProvider` (per-test permission map)
 *   - `AuditLogWriter` (vitest spy so we can assert fire-and-forget calls)
 *   - `RolesService` (each test injects its own service stub)
 *
 * Tests also `vi.mock('../../platform/http/session', ...)` so `requireSession`
 * doesn't need a real Better Auth layer. The router is wrapped with
 * `HttpRouter.catchAllCause(respondCause)` to mirror `buildHttpApp` —
 * without it, `PermissionDenied` / `SessionUnauthorized` failures escape
 * as 500s instead of being mapped to 403 / 401.
 */
import { type Effect } from 'effect';
import type { Permission, Resource } from '@stocket/types/auth';
import type { AuditWriteParams } from '../../../platform/audit/index';
import {
  makeRouterServiceLayer,
  makeRouterTestHarness,
} from '../../../testing/router-harness';
import { rolesRouter } from '../router';
import { RolesService } from '../service';

export interface RolesRouterHarnessOptions {
  readonly service: Record<string, unknown>;
  /** Permissions keyed by resource → list of permissions. Defaults to empty (denies everything). */
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  /**
   * Optional spy used as the audit writer's `log` method. Tests assert
   * this is *called* — the underlying effect is fire-and-forget per
   * `backend/CLAUDE.md`, so coupling to its success is discouraged.
   */
  readonly auditLog?: (
    params: AuditWriteParams,
  ) => Effect.Effect<void, never, unknown>;
}

export interface RolesRouterHarness {
  readonly handler: (request: Request) => Promise<Response>;
  readonly auditSpy: (
    params: AuditWriteParams,
  ) => Effect.Effect<void, never, unknown>;
}

export const makeRolesRouterHarness = (
  opts: RolesRouterHarnessOptions,
): RolesRouterHarness => {
  return makeRouterTestHarness({
    router: rolesRouter,
    layers: [makeRouterServiceLayer(RolesService, opts.service)],
    permissions: opts.permissions,
    auditLog: opts.auditLog,
  });
};
