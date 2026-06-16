/**
 * Router-test harness for `productsRouter`.
 *
 * Builds a web handler with stubbed `ProductsService`, `PermissionProvider`,
 * `BetterAuth` (session), and `AuditLogWriter` layers. The top-level
 * `HttpRouter.catchAllCause(respondCause)` is re-applied so guard/decode
 * failures are mapped to 401/403/400.
 */
import { Effect } from 'effect';
import type { Permission, Resource } from '@stocket/types/auth';
import type { AuditWriteParams } from '../../../platform/audit/index';
import {
  type makeFakeSession,
  makeRouterServiceLayer,
  makeRouterTestHarness,
} from '../../../testing/router-harness';
import { ProductImportService } from '../import/service';
import { ProductImportUnsupportedFormat } from '../products.errors';
import { productsRouter } from '../router';
import { ProductsService } from '../service';

export { FAKE_USER_ID, makeFakeSession } from '../../../testing/router-harness';

export interface ProductsRouterHarnessOptions {
  readonly service: Record<string, unknown>;
  readonly importService?: Record<string, unknown>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  readonly session?: ReturnType<typeof makeFakeSession> | null;
  readonly auditLog?: (
    params: AuditWriteParams,
  ) => Effect.Effect<void, never, unknown>;
}

export interface ProductsRouterHarness {
  readonly handler: (request: Request) => Promise<Response>;
  readonly auditSpy: (
    params: AuditWriteParams,
  ) => Effect.Effect<void, never, unknown>;
}

export const makeProductsRouterHarness = (
  opts: ProductsRouterHarnessOptions,
): ProductsRouterHarness => {
  const importServiceLayer = makeRouterServiceLayer(
    ProductImportService,
    opts.importService ?? {
      importFromCsvContent: () =>
        Effect.fail(
          new ProductImportUnsupportedFormat({
            messageKey: 'products.importUnsupportedFormat',
          }),
        ),
    },
  );

  return makeRouterTestHarness({
    router: productsRouter,
    layers: [
      makeRouterServiceLayer(ProductsService, opts.service),
      importServiceLayer,
    ],
    permissions: opts.permissions,
    roleNames: [],
    session: opts.session,
    provideBetterAuth: true,
    auditLog: opts.auditLog,
  });
};
