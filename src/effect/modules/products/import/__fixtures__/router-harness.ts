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
import { TasksService } from '../../../tasks/service';
import { ProductImportUnsupportedFormat } from '../../products.errors';
import { productImportRouter } from '../router';
import { ProductImportService } from '../service';

export {
  FAKE_USER_ID,
  makeFakeSession,
} from '../../../../testing/router-harness';

export interface ProductImportRouterHarnessOptions {
  readonly importService?: Record<string, unknown>;
  readonly tasksService?: Record<string, unknown>;
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
  const tasksLayer = makeRouterServiceLayer(TasksService, {
    enqueue: () =>
      Effect.dieMessage('TasksService.enqueue was not mocked for this test'),
    findAllPaginated: () =>
      Effect.dieMessage('TasksService.findAllPaginated was not mocked'),
    findOne: () => Effect.dieMessage('TasksService.findOne was not mocked'),
    cancel: () => Effect.dieMessage('TasksService.cancel was not mocked'),
    ...opts.tasksService,
  });

  return makeRouterTestHarness({
    router: productImportRouter,
    layers: [importServiceLayer, featuresLayer, tasksLayer],
    permissions: opts.permissions,
    roleNames: [],
    session: opts.session,
    provideBetterAuth: true,
  });
};
