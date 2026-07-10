import { Effect, Layer } from 'effect';
import { TaskStatus } from '@stocket/types/tasks';
import { makeTaskRow } from '../../../tasks/__fixtures__/task';
import { TaskTerminalObserver } from '../../../tasks/terminal-observer';
import {
  makeInMemoryStorageAdapter,
  StorageAdapter,
} from '../../../../platform/storage';
import { productImportTaskTerminalObserverLayer } from './terminal-observer';
import { productImportBlobKey } from './utils';

const tenantId = '00000000-0000-4000-8000-000000000001';
const blobKey = productImportBlobKey(
  tenantId,
  '10000000-0000-4000-8000-000000000001',
);

describe('productImportTaskTerminalObserverLayer', () => {
  it('cleans the original payload after queued cancellation', async () => {
    const storage = makeInMemoryStorageAdapter({
      [blobKey]: Buffer.from('sku,name\n'),
    });
    const layer = productImportTaskTerminalObserverLayer.pipe(
      Layer.provide(Layer.succeed(StorageAdapter, storage)),
    );

    await Effect.runPromise(
      Effect.flatMap(TaskTerminalObserver, (observer) =>
        observer.onSettled({
          task: makeTaskRow({
            tenant_id: tenantId,
            type: 'product-import',
            status: TaskStatus.CANCELED,
            payload: null,
          }),
          originalPayload: { blobKey, importType: 'auto' },
        }),
      ).pipe(Effect.provide(layer)),
    );

    expect(storage.store.has(blobKey)).toBe(false);
  });

  it('ignores terminal tasks owned by other handlers', async () => {
    const storage = makeInMemoryStorageAdapter({
      [blobKey]: Buffer.from('sku,name\n'),
    });
    const layer = productImportTaskTerminalObserverLayer.pipe(
      Layer.provide(Layer.succeed(StorageAdapter, storage)),
    );

    await Effect.runPromise(
      Effect.flatMap(TaskTerminalObserver, (observer) =>
        observer.onSettled({
          task: makeTaskRow({
            type: 'another-task',
            status: TaskStatus.CANCELED,
          }),
          originalPayload: { blobKey },
        }),
      ).pipe(Effect.provide(layer)),
    );

    expect(storage.store.has(blobKey)).toBe(true);
  });
});
