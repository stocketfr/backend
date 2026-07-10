import { Effect, Layer } from 'effect';
import { TasksInfrastructureError } from '../../../tasks/tasks.errors';
import { toTaskResponseDto } from '../../../tasks/mappers';
import { TasksService } from '../../../tasks/service';
import { makeTaskRow } from '../../../tasks/__fixtures__/task';
import {
  makeInMemoryStorageAdapter,
  StorageAdapter,
} from '../../../../platform/storage';
import { TenantQuery } from '../../../../platform/tenancy/tenant-query';
import { makeTestLayer } from '../../../../testing/utils';
import { ProductImportBackgroundService } from './service';

const tenantId = '00000000-0000-4000-8000-000000000001';
const taskResponse = toTaskResponseDto(
  makeTaskRow({ type: 'product-import' }),
  'en',
);
const taskEnqueueResult = (
  disposition: 'created' | 'existing' = 'created',
) => ({
  task: taskResponse,
  disposition,
});

const buildService = async (
  enqueue: TasksService['enqueue'],
  storage = makeInMemoryStorageAdapter(),
) => {
  const service = await Effect.runPromise(
    ProductImportBackgroundService.pipe(
      Effect.provide(
        ProductImportBackgroundService.DefaultWithoutDependencies.pipe(
          Layer.provide(
            Layer.mergeAll(
              makeTestLayer(TasksService)({ enqueue }),
              makeTestLayer(TenantQuery)({
                tenantId: Effect.succeed(tenantId),
              }),
              Layer.succeed(StorageAdapter, storage),
            ),
          ),
        ),
      ),
    ),
  );
  return { service, storage };
};

describe('ProductImportBackgroundService', () => {
  it('stores the CSV and enqueues only its blob reference', async () => {
    const enqueue = vi.fn<TasksService['enqueue']>(() =>
      Effect.succeed(taskEnqueueResult()),
    );
    const { service, storage } = await buildService(enqueue);
    const bytes = Buffer.from('sku,name\nSKU-1,Whisky\n');

    await expect(
      Effect.runPromise(
        service.enqueue({
          bytes,
          importType: 'auto',
          idempotencyKey: 'request-1',
          userId: 'user-1',
        }),
      ),
    ).resolves.toEqual(taskResponse);

    const [blobKey] = [...storage.store.keys()];
    expect(blobKey).toMatch(
      /^background-tasks\/product-import\/[0-9a-f-]+\/[0-9a-f-]+\.csv$/,
    );
    expect(storage.store.get(blobKey ?? '')?.equals(bytes)).toBe(true);
    expect(enqueue).toHaveBeenCalledWith({
      type: 'product-import',
      payload: { blobKey, importType: 'auto' },
      createdBy: 'user-1',
      idempotencyKey: 'request-1',
      maxAttempts: 3,
      progress: { messageKey: 'products.importProgressQueued' },
    });
  });

  it('deletes the losing blob when enqueueing reuses an existing task', async () => {
    const enqueue = vi.fn<TasksService['enqueue']>(() =>
      Effect.succeed(taskEnqueueResult('existing')),
    );
    const { service, storage } = await buildService(enqueue);

    await expect(
      Effect.runPromise(
        service.enqueue({
          bytes: Buffer.from('sku,name\nSKU-1,Whisky\n'),
          importType: 'auto',
          idempotencyKey: 'request-1',
          userId: 'user-1',
        }),
      ),
    ).resolves.toEqual(taskResponse);

    expect(storage.store.size).toBe(0);
  });

  it('deletes the blob when task enqueueing fails', async () => {
    const enqueueError = new TasksInfrastructureError({
      action: 'enqueue',
      messageKey: 'tasks.repositoryFailed',
    });
    const enqueue = vi.fn<TasksService['enqueue']>(() =>
      Effect.fail(enqueueError),
    );
    const { service, storage } = await buildService(enqueue);

    await expect(
      Effect.runPromise(
        service.enqueue({
          bytes: Buffer.from('sku,name\n'),
          importType: 'auto',
          userId: 'user-1',
        }),
      ),
    ).rejects.toBeDefined();
    expect(storage.store.size).toBe(0);
  });
});
