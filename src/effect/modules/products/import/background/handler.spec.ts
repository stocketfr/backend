import { Effect } from 'effect';
import { makeTaskRow } from '../../../tasks/__fixtures__/task';
import type { TaskExecutionContext } from '../../../tasks/worker/types';
import {
  TaskExecutionCanceled,
  TaskExecutionFailed,
  TaskPayloadInvalid,
} from '../../../tasks/worker/worker.errors';
import { makeInMemoryStorageAdapter } from '../../../../platform/storage';
import { ProductImportCancelled } from '../../products.errors';
import type { ProductImportService } from '../service';
import { makeEmptyProductImportResult } from '../utils/result';
import { makeProductImportTaskHandler } from './handler';
import { productImportBlobKey } from './utils';

const tenantId = '00000000-0000-4000-8000-000000000001';
const blobKey = productImportBlobKey(
  tenantId,
  '10000000-0000-4000-8000-000000000001',
);

const makeTask = (payload: unknown = { blobKey, importType: 'auto' }) =>
  makeTaskRow({
    tenant_id: tenantId,
    type: 'product-import',
    payload,
    created_by: 'user-1',
  });

const executionContext: TaskExecutionContext = {
  task: makeTask(),
  reportProgress: () => Effect.void,
  isCancellationRequested: Effect.succeed(false),
};

describe('ProductImportTaskHandler', () => {
  it('loads the blob, executes the import, and reports typed progress', async () => {
    const storage = makeInMemoryStorageAdapter({
      [blobKey]: Buffer.from('sku,name\nSKU-1,Whisky\n'),
    });
    const progress: unknown[] = [];
    const context: TaskExecutionContext = {
      ...executionContext,
      reportProgress: (patch) =>
        Effect.sync(() => {
          progress.push(patch);
        }),
    };
    const result = makeEmptyProductImportResult();
    const importFromCsvContent: ProductImportService['importFromCsvContent'] = (
      options,
    ) =>
      Effect.gen(function* () {
        yield* options.hooks?.onProgress?.({
          total: 1,
          processed: 1,
          failed: 0,
          messageKey: 'products.importProgressRowsProcessed',
          force: true,
        }) ?? Effect.void;
        return result;
      });
    const handler = makeProductImportTaskHandler({
      productImport: { importFromCsvContent },
      storage,
      authorize: Effect.void,
    });

    await expect(
      Effect.runPromise(handler.run(makeTask(), context)),
    ).resolves.toEqual(result);
    expect(progress).toEqual([
      {
        total: 1,
        processed: 1,
        failed: 0,
        messageKey: 'products.importProgressRowsProcessed',
        messageArgs: { processedRows: 1, totalRows: 1 },
        force: true,
      },
    ]);
  });

  it('maps a missing input blob to a permanent task failure', async () => {
    const storage = makeInMemoryStorageAdapter();
    const importFromCsvContent: ProductImportService['importFromCsvContent'] =
      () => Effect.succeed(makeEmptyProductImportResult());
    const handler = makeProductImportTaskHandler({
      productImport: { importFromCsvContent },
      storage,
      authorize: Effect.void,
    });

    const error = await Effect.runPromise(
      Effect.flip(handler.run(makeTask(), executionContext)),
    );
    expect(error).toBeInstanceOf(TaskExecutionFailed);
    expect(error).toMatchObject({ retryable: false });
  });

  it('rejects blob references outside the task tenant prefix', async () => {
    const storage = makeInMemoryStorageAdapter();
    const importFromCsvContent: ProductImportService['importFromCsvContent'] =
      () => Effect.succeed(makeEmptyProductImportResult());
    const handler = makeProductImportTaskHandler({
      productImport: { importFromCsvContent },
      storage,
      authorize: Effect.void,
    });
    const task = makeTask({
      blobKey: 'products/product-1/photos/photo.jpg',
      importType: 'auto',
    });

    const error = await Effect.runPromise(
      Effect.flip(handler.run(task, { ...executionContext, task })),
    );
    expect(error).toBeInstanceOf(TaskPayloadInvalid);
  });

  it('maps cooperative cancellation to task cancellation', async () => {
    const storage = makeInMemoryStorageAdapter({
      [blobKey]: Buffer.from('sku,name\n'),
    });
    const importFromCsvContent: ProductImportService['importFromCsvContent'] =
      () =>
        Effect.fail(
          new ProductImportCancelled({
            messageKey: 'products.importCancelled',
          }),
        );
    const handler = makeProductImportTaskHandler({
      productImport: { importFromCsvContent },
      storage,
      authorize: Effect.void,
    });

    const error = await Effect.runPromise(
      Effect.flip(handler.run(makeTask(), executionContext)),
    );
    expect(error).toBeInstanceOf(TaskExecutionCanceled);
  });

  it('deletes the blob only from the post-settlement hook', async () => {
    const storage = makeInMemoryStorageAdapter({
      [blobKey]: Buffer.from('sku,name\n'),
    });
    const importFromCsvContent: ProductImportService['importFromCsvContent'] =
      () => Effect.succeed(makeEmptyProductImportResult());
    const handler = makeProductImportTaskHandler({
      productImport: { importFromCsvContent },
      storage,
      authorize: Effect.void,
    });
    const task = makeTask();

    await Effect.runPromise(handler.run(task, executionContext));
    expect(storage.store.has(blobKey)).toBe(true);
    await Effect.runPromise(
      handler.onSettled?.(task, 'succeeded') ?? Effect.void,
    );
    expect(storage.store.has(blobKey)).toBe(false);
  });
});
