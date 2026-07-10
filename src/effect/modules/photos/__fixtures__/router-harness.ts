/**
 * Router-test harness for `productPhotosRouter` + `photosRouter`.
 *
 * The router depends on `PhotosService`, `PermissionProvider`, a Better
 * Auth session, and (for `DELETE`/message envelopes) `AuditLogWriter`
 * isn't used here — photos doesn't audit on its current routes — so we
 * still provide a no-op one in case that changes.
 *
 * We merge both routers with `HttpRouter.concat` to mirror the real
 * application wiring where the two sit at `/products` and `/photos`
 * respectively. `HttpRouter.catchAllCause(respondCause)` is re-applied
 * so guard/decode failures are mapped to 401/403/400.
 *
 * NOTE: the upload route parses `multipart/form-data` via
 * `HttpServerRequest.schemaBodyMultipart`. Decoding a real multipart body
 * in a unit test requires a `FileSystem` and `Path` layer and writes
 * temp files to disk — overkill for a boundary test. Consumers of this
 * harness are expected to mock `@effect/platform`'s multipart entry point
 * at the test-file level (see `router.spec.ts`).
 */
import { HttpRouter } from '@effect/platform';
import type { Permission, Resource } from '@stocket/types/auth';
import {
  type makeFakeSession,
  makeRouterServiceLayer,
  makeRouterTestHarness,
  type RouterAuditLog,
} from '../../../testing/router-harness';
import { photosRouter, productPhotosRouter } from '../router';
import { PhotosService } from '../service';

export { FAKE_USER_ID, makeFakeSession } from '../../../testing/router-harness';

export interface PhotosRouterHarnessOptions {
  readonly service: Record<string, unknown>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  readonly session?: ReturnType<typeof makeFakeSession> | null;
  readonly auditLog?: RouterAuditLog;
}

export interface PhotosRouterHarness {
  readonly handler: (request: Request) => Promise<Response>;
  readonly auditSpy: RouterAuditLog;
}

export const makePhotosRouterHarness = (
  opts: PhotosRouterHarnessOptions,
): PhotosRouterHarness => {
  return makeRouterTestHarness({
    router: HttpRouter.concat(productPhotosRouter, photosRouter),
    layers: [makeRouterServiceLayer(PhotosService, opts.service)],
    permissions: opts.permissions,
    roleNames: [],
    session: opts.session,
    provideBetterAuth: true,
    auditLog: opts.auditLog,
  });
};
