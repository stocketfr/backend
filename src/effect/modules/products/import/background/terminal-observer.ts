import { Effect, Layer } from 'effect';
import { StorageAdapter } from '../../../../platform/storage';
import { TaskTerminalObserver } from '../../../tasks/terminal-observer';
import { cleanupProductImportBlob } from './cleanup';
import { PRODUCT_IMPORT_TASK_TYPE } from './types';

export const productImportTaskTerminalObserverLayer = Layer.effect(
  TaskTerminalObserver,
  Effect.map(StorageAdapter, (storage) => ({
    onSettled: ({ originalPayload, task }) =>
      task.type === PRODUCT_IMPORT_TASK_TYPE
        ? cleanupProductImportBlob(storage, {
            taskId: task.id,
            tenantId: task.tenant_id,
            payload: originalPayload,
          })
        : Effect.void,
  })),
);
