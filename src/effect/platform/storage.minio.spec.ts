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

    it.effect('deletes objects by prefix', () =>
      Effect.gen(function* () {
        const storage = yield* StorageAdapter;
        const prefix = `smoke/${randomUUID()}/`;
        const first = `${prefix}first.txt`;
        const second = `${prefix}second.txt`;
        const outside = `smoke/${randomUUID()}.txt`;
        const bytes = new TextEncoder().encode('storage smoke');

        yield* storage.putObject(first, bytes, { contentType: 'text/plain' });
        yield* storage.putObject(second, bytes, { contentType: 'text/plain' });
        yield* storage.putObject(outside, bytes, { contentType: 'text/plain' });

        yield* storage.deletePrefix(prefix);

        const missingFirst = yield* Effect.flip(storage.getObject(first));
        const missingSecond = yield* Effect.flip(storage.getObject(second));
        const kept = yield* storage.getObject(outside);

        assert.strictEqual(missingFirst._tag, 'StorageObjectNotFound');
        assert.strictEqual(missingSecond._tag, 'StorageObjectNotFound');
        assert.strictEqual(
          new TextDecoder().decode(kept.bytes),
          'storage smoke',
        );

        yield* storage.deleteObject(outside);
      }).pipe(Effect.provide(storageLayer)),
    );
  },
);
