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
import { FeatureKey } from '@stocket/types/features';
import {
  type makeFakeSession,
  makeRouterServiceLayer,
  makeRouterTestHarness,
  type RouterAuditLog,
} from '../../../testing/router-harness';
import { ProductImportService } from '../import/service';
import { FeatureNotEnabled } from '../../features/features.errors';
import { FeaturesService } from '../../features/service';
import { ProductImportUnsupportedFormat } from '../products.errors';
import { productsRouter } from '../router';
import { ProductsService } from '../service';

export { FAKE_USER_ID, makeFakeSession } from '../../../testing/router-harness';

export interface ProductsRouterHarnessOptions {
  readonly service: Record<string, unknown>;
  readonly importService?: Record<string, unknown>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  readonly session?: ReturnType<typeof makeFakeSession> | null;
  readonly auditLog?: RouterAuditLog;
  readonly smartImportFeatureEnabled?: boolean;
}

export interface ProductsRouterHarness {
  readonly handler: (request: Request) => Promise<Response>;
  readonly auditSpy: RouterAuditLog;
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
      previewCsvContent: () =>
        Effect.fail(
          new ProductImportUnsupportedFormat({
            messageKey: 'products.importUnsupportedFormat',
          }),
        ),
      proposeImportPlan: () =>
        Effect.fail(
          new ProductImportUnsupportedFormat({
            messageKey: 'products.importUnsupportedFormat',
          }),
        ),
    },
  );
  const featuresLayer = makeRouterServiceLayer(FeaturesService, {
    requireFeature: (featureKey: FeatureKey) =>
      featureKey === FeatureKey.SMART_IMPORT &&
      opts.smartImportFeatureEnabled === false
        ? Effect.fail(
            new FeatureNotEnabled({
              featureKey,
              messageKey: 'features.notEnabled',
            }),
          )
        : Effect.void,
  });

  return makeRouterTestHarness({
    router: productsRouter,
    layers: [
      makeRouterServiceLayer(ProductsService, opts.service),
      importServiceLayer,
      featuresLayer,
    ],
    permissions: opts.permissions,
    roleNames: [],
    session: opts.session,
    provideBetterAuth: true,
    auditLog: opts.auditLog,
  });
};
