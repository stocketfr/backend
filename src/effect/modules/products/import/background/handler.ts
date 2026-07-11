import { FeatureKey } from '@stocket/types/features';
import { Effect, Layer, Schema } from 'effect';
import { Buffer } from 'node:buffer';
import { FeaturesService } from '../../../features/service';
import { TaskRegistry, makeTaskRegistry } from '../../../tasks/worker/registry';
import type {
  TaskExecutionContext,
  TaskHandler,
} from '../../../tasks/worker/types';
import {
  TaskExecutionCanceled,
  TaskExecutionFailed,
  TaskPayloadInvalid,
} from '../../../tasks/worker/worker.errors';
import {
  StorageAdapter,
  type StorageError,
  type StorageObjectNotFound,
} from '../../../../platform/storage';
import type {
  FeatureNotEnabled,
  FeaturesInfrastructureError,
  FeatureTenantNotFound,
} from '../../../features/features.errors';
import type { TenantNotResolved } from '../../../../platform/tenancy/tenant-context';
import type { ProductImportService } from '../service';
import { ProductImportService as ProductImportServiceTag } from '../service';
import { PRODUCT_IMPORT_PROGRESS_MESSAGES } from '../types';
import {
  PRODUCT_IMPORT_TASK_TYPE,
  productImportTaskPayloadSchema,
} from './types';
import { cleanupProductImportBlob } from './cleanup';

type ProductImportAuthorizationError =
  | FeatureNotEnabled
  | FeaturesInfrastructureError
  | FeatureTenantNotFound
  | TenantNotResolved;

interface ProductImportExecutor {
  readonly importFromCsvContent: ProductImportService['importFromCsvContent'];
}

interface ProductImportTaskHandlerDependencies {
  readonly productImport: ProductImportExecutor;
  readonly storage: StorageAdapter;
  readonly authorize: Effect.Effect<void, ProductImportAuthorizationError>;
}

const decodePayload = (task: TaskExecutionContext['task']) =>
  Schema.decodeUnknown(productImportTaskPayloadSchema(task.tenant_id))(
    task.payload,
  ).pipe(
    Effect.mapError(
      () =>
        new TaskPayloadInvalid({
          details: 'Product import task payload is invalid',
        }),
    ),
  );

const mapAuthorizationError = (
  error: ProductImportAuthorizationError,
): TaskExecutionFailed => {
  switch (error._tag) {
    case 'FeaturesInfrastructureError':
    case 'TenantNotResolved':
      return new TaskExecutionFailed({
        error: 'Could not verify product import feature access',
        retryable: true,
      });
    case 'FeatureNotEnabled':
    case 'FeatureTenantNotFound':
      return new TaskExecutionFailed({
        error: 'Product import feature is not available',
        retryable: false,
      });
  }
};

const mapStorageReadError = (
  error: StorageError | StorageObjectNotFound,
): TaskExecutionFailed =>
  error._tag === 'StorageObjectNotFound'
    ? new TaskExecutionFailed({
        error: 'Product import input file no longer exists',
        retryable: false,
      })
    : new TaskExecutionFailed({
        error: 'Could not read the product import input file',
        retryable: true,
      });

const progressMessageArgs = (
  messageKey: string,
  processed: number,
  total: number,
) =>
  messageKey === PRODUCT_IMPORT_PROGRESS_MESSAGES.rowsProcessed
    ? { processedRows: processed, totalRows: total }
    : undefined;

export const makeProductImportTaskHandler = ({
  productImport,
  storage,
  authorize,
}: ProductImportTaskHandlerDependencies): TaskHandler => ({
  type: PRODUCT_IMPORT_TASK_TYPE,
  run: (task, context) =>
    Effect.gen(function* () {
      yield* authorize.pipe(Effect.mapError(mapAuthorizationError));
      const payload = yield* decodePayload(task);
      const stored = yield* storage
        .getObject(payload.blobKey)
        .pipe(Effect.mapError(mapStorageReadError));

      return yield* productImport
        .importFromCsvContent({
          content: Buffer.from(stored.bytes).toString('utf8'),
          importType: payload.importType,
          approvedPlan: payload.approvedPlan,
          userId: task.created_by,
          hooks: {
            onProgress: (progress) =>
              context.reportProgress({
                total: progress.total,
                processed: progress.processed,
                failed: progress.failed,
                messageKey: progress.messageKey,
                messageArgs: progressMessageArgs(
                  progress.messageKey,
                  progress.processed,
                  progress.total,
                ),
                force: progress.force,
              }),
            isCancellationRequested: context.isCancellationRequested,
          },
        })
        .pipe(
          Effect.catchTags({
            ProductImportCancelled: () =>
              Effect.fail(
                new TaskExecutionCanceled({
                  reason: 'Task canceled during product import',
                }),
              ),
            ProductImportCsvParseFailed: () =>
              Effect.fail(
                new TaskExecutionFailed({
                  error: 'Could not parse the product import CSV file',
                  retryable: false,
                }),
              ),
            ProductImportUnsupportedFormat: () =>
              Effect.fail(
                new TaskExecutionFailed({
                  error: 'Unsupported product import CSV headers',
                  retryable: false,
                }),
              ),
            ProductImportProposalInvalid: () =>
              Effect.fail(
                new TaskExecutionFailed({
                  error: 'Product import plan is invalid',
                  retryable: false,
                }),
              ),
            ProductInfrastructureError: () =>
              Effect.fail(
                new TaskExecutionFailed({
                  error: 'Product import infrastructure operation failed',
                  retryable: true,
                }),
              ),
            TenantNotResolved: () =>
              Effect.fail(
                new TaskExecutionFailed({
                  error: 'Product import tenant context could not be resolved',
                  retryable: true,
                }),
              ),
          }),
        );
    }),
  onSettled: (task) =>
    cleanupProductImportBlob(storage, {
      taskId: task.id,
      tenantId: task.tenant_id,
      payload: task.payload,
    }),
});

export const productImportTaskRegistryLayer = Layer.effect(
  TaskRegistry,
  Effect.gen(function* () {
    const productImport = yield* ProductImportServiceTag;
    const storage = yield* StorageAdapter;
    const features = yield* FeaturesService;
    return makeTaskRegistry([
      makeProductImportTaskHandler({
        productImport,
        storage,
        authorize: features.requireFeature(FeatureKey.SMART_IMPORT),
      }),
    ]);
  }),
);
