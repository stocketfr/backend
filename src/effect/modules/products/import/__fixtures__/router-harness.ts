import { Effect } from 'effect';
import type { Permission, Resource } from '@stocket/types/auth';
import { FeatureKey } from '@stocket/types/features';
import {
  type makeFakeSession,
  makeRouterServiceLayer,
  makeRouterTestHarness,
} from '../../../../testing/router-harness';
import { FeatureNotEnabled } from '../../../features/features.errors';
import { FeaturesService } from '../../../features/service';
import { ProductImportUnsupportedFormat } from '../../products.errors';
import { productImportRouter } from '../router';
import { ProductImportService } from '../service';
import { ProductImportBackgroundService } from '../background/service';

export {
  FAKE_USER_ID,
  makeFakeSession,
} from '../../../../testing/router-harness';

export interface ProductImportRouterHarnessOptions {
  readonly importService?: Record<string, unknown>;
  readonly backgroundService?: Record<string, unknown>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  readonly session?: ReturnType<typeof makeFakeSession> | null;
  readonly smartImportFeatureEnabled?: boolean;
}

export const makeProductImportRouterHarness = (
  opts: ProductImportRouterHarnessOptions,
) => {
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
  const backgroundServiceLayer = makeRouterServiceLayer(
    ProductImportBackgroundService,
    opts.backgroundService ?? {
      enqueue: () => Effect.dieMessage('Unexpected product import enqueue'),
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
    router: productImportRouter,
    layers: [importServiceLayer, backgroundServiceLayer, featuresLayer],
    permissions: opts.permissions,
    roleNames: [],
    session: opts.session,
    provideBetterAuth: true,
  });
};
