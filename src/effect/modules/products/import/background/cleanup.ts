import { Effect, Schema } from 'effect';
import type { StorageAdapter } from '../../../../platform/storage';
import { createLogger } from '../../../../platform/observability/messages';
import { productImportBlobReferenceSchema } from './types';

const logger = createLogger('products');

export interface ProductImportBlobCleanupOptions {
  readonly taskId: string;
  readonly tenantId: string;
  readonly payload: unknown;
}

export const cleanupProductImportBlob = (
  storage: StorageAdapter,
  options: ProductImportBlobCleanupOptions,
): Effect.Effect<void> =>
  Schema.decodeUnknown(productImportBlobReferenceSchema(options.tenantId))(
    options.payload,
  ).pipe(
    Effect.matchEffect({
      onFailure: () => Effect.void,
      onSuccess: ({ blobKey }) =>
        storage.deleteObject(blobKey).pipe(
          Effect.catchAll((error) =>
            logger.error('importBlobCleanupFailed', {
              taskId: options.taskId,
              error,
            }),
          ),
        ),
    }),
  );
