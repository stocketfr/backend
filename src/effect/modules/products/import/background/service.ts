import { Effect } from 'effect';
import { randomUUID } from 'node:crypto';
import { PRODUCT_IMPORT_PROGRESS_MESSAGES } from '../types';
import { retainOnCreate } from '../../../../platform/effect/create-or-reuse';
import { StorageAdapter } from '../../../../platform/storage';
import { TenantQuery } from '../../../../platform/tenancy/tenant-query';
import { makeServiceTracer } from '../../../../platform/observability/service-tracer';
import { TasksService } from '../../../tasks/service';
import { productImportBlobKey } from './utils';
import {
  PRODUCT_IMPORT_TASK_TYPE,
  type EnqueueProductImportOptions,
} from './types';

export class ProductImportBackgroundService extends Effect.Service<ProductImportBackgroundService>()(
  '@stocket/effect/products/import/ProductImportBackgroundService',
  {
    effect: Effect.gen(function* () {
      const storage = yield* StorageAdapter;
      const tasks = yield* TasksService;
      const tenantQuery = yield* TenantQuery;
      const trace = makeServiceTracer({
        serviceName: 'ProductImportBackgroundService',
        module: 'products',
        layer: 'service',
      });

      const enqueue = (options: EnqueueProductImportOptions) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          const blobKey = productImportBlobKey(tenantId, randomUUID());
          const payload = {
            blobKey,
            importType: options.importType,
            ...(options.approvedPlan === undefined
              ? {}
              : { approvedPlan: options.approvedPlan }),
          } satisfies Readonly<Record<string, unknown>>;

          yield* storage.putObject(blobKey, options.bytes, {
            contentType: 'text/csv; charset=utf-8',
          });

          return yield* retainOnCreate(
            tasks
              .enqueue({
                type: PRODUCT_IMPORT_TASK_TYPE,
                payload,
                createdBy: options.userId,
                idempotencyKey: options.idempotencyKey,
                maxAttempts: 3,
                progress: {
                  messageKey: PRODUCT_IMPORT_PROGRESS_MESSAGES.queued,
                },
              })
              .pipe(
                Effect.map((result) => ({
                  value: result.task,
                  disposition: result.disposition,
                })),
              ),
            storage.deleteObject(blobKey),
          );
        }).pipe(trace.span('enqueue'));

      return { enqueue };
    }),
    dependencies: [TasksService.Default, TenantQuery.Default],
  },
) {}
