import { randomUUID } from 'node:crypto';
import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { StorageAdapter, storageLayer } from './storage';

describe.skipIf(process.env.RUN_MINIO_STORAGE_SMOKE !== 'true')(
  'MinIO storage smoke',
  () => {
    it.effect('writes, reads, and deletes an object', () =>
      Effect.gen(function* () {
        const storage = yield* StorageAdapter;
        const key = `smoke/${randomUUID()}.txt`;
        const bytes = new TextEncoder().encode('storage smoke');

        yield* storage.putObject(key, bytes, { contentType: 'text/plain' });
        const stored = yield* storage.getObject(key);
        assert.strictEqual(
          new TextDecoder().decode(stored.bytes),
          'storage smoke',
        );

        yield* storage.deleteObject(key);
        const missing = yield* Effect.flip(storage.getObject(key));
        assert.strictEqual(missing._tag, 'StorageObjectNotFound');
      }).pipe(Effect.provide(storageLayer)),
    );
  },
);
