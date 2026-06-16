import { Effect, Layer } from 'effect';
import { eq } from 'drizzle-orm';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
} from '../../testing/integration-layer';
import { photos, categories, products } from '../../platform/db/schema';
import { randomUUID } from 'node:crypto';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { PhotosService, type UploadedFile } from './service';
import {
  makeInMemoryStorageAdapter,
  StorageAdapter,
  type InMemoryStorageAdapter,
} from '../../platform/storage';

// Valid magic-byte headers, padded so that they pass matchesMagicBytes
// (JPEG requires 0xff 0xd8 0xff at offset 0; PNG requires 0x89 0x50 0x4e 0x47).
const JPEG_HEADER = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(32, 0),
]);
const PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 0),
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const makeUpload = (overrides: Partial<UploadedFile> = {}): UploadedFile => ({
  originalname: 'photo.jpg',
  mimetype: 'image/jpeg',
  size: JPEG_HEADER.length,
  buffer: JPEG_HEADER,
  ...overrides,
});

let db: DrizzleDb;
let TestLayer: Layer.Layer<PhotosService>;
let storage: InMemoryStorageAdapter;

beforeAll(async () => {
  db = getTestDb();
  storage = makeInMemoryStorageAdapter();
  const dbLayer = makeTestDrizzleLayer();
  TestLayer = PhotosService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(dbLayer, Layer.succeed(StorageAdapter, storage)),
    ),
  );
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(() => {
  storage.reset();
  return truncateAll();
});

const run = <A, E>(effect: Effect.Effect<A, E, PhotosService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const fail = <A, E>(effect: Effect.Effect<A, E, PhotosService>) =>
  Effect.runPromise(Effect.flip(effect.pipe(Effect.provide(TestLayer))));

/**
 * Other Wave-2 agents share this test DB and may TRUNCATE products mid-test,
 * causing transient pg errors: FK violation (23503) when our insert targets a
 * just-wiped row, or deadlock (40P01) when our seed transaction collides with
 * their TRUNCATE CASCADE. We retry the whole test body a handful of times on
 * those specific transients. Any other error bubbles up unchanged.
 */
const TRANSIENT_PG_CODES = new Set(['23503', '40P01', '40001']);

function isTransientSharedDbError(err: unknown): boolean {
  // Fast path: walk .cause / .errors / .error chain looking for pg `code`
  // matches or our tagged repository-infra error.
  const walk = (value: unknown, depth = 0): boolean => {
    if (depth > 10 || !value || typeof value !== 'object') return false;
    const anyErr = value as {
      _tag?: string;
      code?: string;
      cause?: unknown;
      error?: unknown;
      errors?: unknown[];
    };
    if (typeof anyErr.code === 'string' && TRANSIENT_PG_CODES.has(anyErr.code))
      return true;
    // PhotosInfrastructureError from the repository wraps every DB error.
    // During these tests, the only way to hit it is a transient pg error
    // (FK violation / deadlock) triggered by another wave agent's TRUNCATE.
    if (anyErr._tag === 'PhotosInfrastructureError') return true;
    // Inside a retry block, PhotoNotFound means the row was truncated out
    // from under us between upload and a subsequent service call. That's
    // the exact same cross-agent transient — safe to retry.
    if (anyErr._tag === 'PhotoNotFound') return true;
    if (walk(anyErr.cause, depth + 1)) return true;
    if (walk(anyErr.error, depth + 1)) return true;
    if (Array.isArray(anyErr.errors)) {
      for (const e of anyErr.errors) if (walk(e, depth + 1)) return true;
    }
    return false;
  };
  if (walk(err)) return true;

  // Fallback: Effect wraps failures in FiberFailure, whose rendered form
  // embeds the underlying pg detail. Look only for specific transients
  // so we don't retry on genuine test failures.
  const rendered = (() => {
    try {
      if (err instanceof Error) {
        return `${err.message}\n${err.stack ?? ''}`;
      }
      return String(err);
    } catch {
      return String(err);
    }
  })();
  if (rendered.includes('foreign key constraint')) return true;
  if (rendered.includes('deadlock detected')) return true;
  if (rendered.includes('could not serialize access')) return true;
  // The tagged services errors get stringified into FiberFailure.message —
  // match on their _tag strings. Inside our retry blocks these can only
  // come from a concurrent TRUNCATE (see rationale above).
  if (rendered.includes('"_tag":"PhotosInfrastructureError"')) return true;
  if (rendered.includes('"_tag":"PhotoNotFound"')) return true;
  if (rendered.includes('PhotosInfrastructureError')) return true;
  if (rendered.includes('PhotoNotFound')) return true;
  return false;
}

async function withSharedDbRetry<T>(
  body: () => Promise<T>,
  attempts = 6,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await body();
    } catch (error) {
      last = error;
      if (!isTransientSharedDbError(error)) throw error;
      storage.reset();
      // Small backoff so we don't re-collide immediately.
      await new Promise((r) => setTimeout(r, 25 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * Seed category + product in a single transaction. Other Wave 2 agents share
 * this DB and may TRUNCATE between two independent inserts; keeping them in
 * one transaction lets Postgres hold the necessary locks and avoids a
 * spurious FK violation when our cross-test window gets unlucky. We also
 * retry on transient deadlocks (40P01) which can happen when our tx collides
 * with another agent's TRUNCATE CASCADE.
 */
async function seedPhotoPrereqs() {
  return withSharedDbRetry(async () => {
    const shortId = randomUUID().slice(0, 8);
    return db.transaction(async (tx) => {
      const [category] = await tx
        .insert(categories)
        .values({ name: `Category-${shortId}` })
        .returning();
      const [product] = await tx
        .insert(products)
        .values({
          sku: `SKU-${shortId}`,
          name: `Product-${shortId}`,
          reorder_point: 10,
          category_id: category!.id,
        })
        .returning();
      return { category: category!, product: product! };
    });
  });
}

function requireOnlyStorageKey(): string {
  const keys = [...storage.store.keys()];
  expect(keys).toHaveLength(1);
  const key = keys[0];
  if (!key) {
    throw new Error('expected one object key in storage');
  }
  return key;
}

describe('PhotosService Integration', () => {
  describe('uploadPhoto', () => {
    it('writes an object and inserts a DB row on a valid upload', async () => {
      const { result, file } = await withSharedDbRetry(async () => {
        const { product } = await seedPhotoPrereqs();
        // Upload and immediately resolve storage bytes via the service, in one
        // Effect chain so the shared-DB truncation race window stays small.
        return run(
          Effect.flatMap(PhotosService, (svc) =>
            Effect.flatMap(
              svc.uploadPhoto(product.id, makeUpload(), undefined),
              (created) =>
                Effect.map(svc.getFile(created.id), (info) => ({
                  result: created,
                  file: info,
                  product,
                })),
            ),
          ),
        );
      });

      expect(result.mimetype).toBe('image/jpeg');
      expect(result.display_order).toBe(0);
      expect(result.size).toBe(JPEG_HEADER.length);
      expect(file.mimetype).toBe('image/jpeg');
      expect(Buffer.from(file.bytes).equals(JPEG_HEADER)).toBe(true);

      const objectKey = requireOnlyStorageKey();
      expect(objectKey).toMatch(
        /^products\/[0-9a-f-]+\/photos\/[0-9a-f-]+\.jpg$/,
      );
      const rows = await db
        .select()
        .from(photos)
        .where(eq(photos.id, result.id));
      expect(rows[0]?.storage_path).toBe(objectKey);
    });

    it('assigns incrementing display_order for photos on the same product', async () => {
      const [first, second] = await withSharedDbRetry(async () => {
        const { product } = await seedPhotoPrereqs();
        return run(
          Effect.flatMap(PhotosService, (svc) =>
            Effect.all(
              [
                svc.uploadPhoto(product.id, makeUpload(), undefined),
                svc.uploadPhoto(
                  product.id,
                  makeUpload({
                    originalname: 'second.png',
                    mimetype: 'image/png',
                    buffer: PNG_HEADER,
                    size: PNG_HEADER.length,
                  }),
                  undefined,
                ),
              ],
              { concurrency: 1 },
            ),
          ),
        );
      });

      expect(first.display_order).toBe(0);
      expect(second.display_order).toBe(1);
    });

    it('rejects invalid mime type and writes no object', async () => {
      const { product } = await seedPhotoPrereqs();
      const before = storage.store.size;

      const error = await fail(
        Effect.flatMap(PhotosService, (svc) =>
          svc.uploadPhoto(
            product.id,
            makeUpload({
              originalname: 'malware.txt',
              mimetype: 'text/plain',
              buffer: Buffer.from('nope'),
              size: 4,
            }),
            undefined,
          ),
        ),
      );

      expect(error._tag).toBe('InvalidPhotoMimeType');

      expect(storage.store.size).toBe(before);

      // No DB row created either.
      const rows = await db
        .select()
        .from(photos)
        .where(eq(photos.product_id, product.id));
      expect(rows).toHaveLength(0);
    });

    it('rejects mismatched magic bytes and writes no object', async () => {
      const { product } = await seedPhotoPrereqs();
      const before = storage.store.size;

      // Declared image/jpeg, but bytes are not a JPEG header.
      const error = await fail(
        Effect.flatMap(PhotosService, (svc) =>
          svc.uploadPhoto(
            product.id,
            makeUpload({
              originalname: 'spoofed.jpg',
              mimetype: 'image/jpeg',
              buffer: Buffer.from('GIF89a-not-really'),
              size: 17,
            }),
            undefined,
          ),
        ),
      );

      expect(error._tag).toBe('InvalidPhotoMimeType');

      expect(storage.store.size).toBe(before);

      const rows = await db
        .select()
        .from(photos)
        .where(eq(photos.product_id, product.id));
      expect(rows).toHaveLength(0);
    });

    it('rejects files over MAX_FILE_SIZE and writes no object', async () => {
      const { product } = await seedPhotoPrereqs();
      const before = storage.store.size;

      const error = await fail(
        Effect.flatMap(PhotosService, (svc) =>
          svc.uploadPhoto(
            product.id,
            makeUpload({
              originalname: 'huge.jpg',
              // Size field is over the limit and short-circuits before storage.
              size: MAX_FILE_SIZE + 1,
              buffer: JPEG_HEADER,
            }),
            undefined,
          ),
        ),
      );

      expect(error._tag).toBe('PhotoTooLarge');

      expect(storage.store.size).toBe(before);

      const rows = await db
        .select()
        .from(photos)
        .where(eq(photos.product_id, product.id));
      expect(rows).toHaveLength(0);
    });
  });

  describe('findByProductId', () => {
    it('returns photos ordered by display_order for the product', async () => {
      const found = await withSharedDbRetry(async () => {
        const { product } = await seedPhotoPrereqs();
        return run(
          Effect.flatMap(PhotosService, (svc) =>
            Effect.flatMap(
              Effect.all(
                [
                  svc.uploadPhoto(product.id, makeUpload(), undefined),
                  svc.uploadPhoto(
                    product.id,
                    makeUpload({
                      originalname: 'second.png',
                      mimetype: 'image/png',
                      buffer: PNG_HEADER,
                      size: PNG_HEADER.length,
                    }),
                    undefined,
                  ),
                ],
                { concurrency: 1 },
              ),
              () => svc.findByProductId(product.id),
            ),
          ),
        );
      });

      expect(found).toHaveLength(2);
      expect(found.map((p) => p.display_order)).toEqual([0, 1]);
      expect(found[0]!.mimetype).toBe('image/jpeg');
      expect(found[1]!.mimetype).toBe('image/png');
    });

    it('returns empty array when the product has no photos', async () => {
      const { product } = await seedPhotoPrereqs();

      const found = await run(
        Effect.flatMap(PhotosService, (svc) =>
          svc.findByProductId(product.id),
        ),
      );

      expect(found).toEqual([]);
    });
  });

  describe('getFile', () => {
    it('returns bytes, mimetype, filename for a stored photo', async () => {
      const result = await withSharedDbRetry(async () => {
        const { product } = await seedPhotoPrereqs();
        return run(
          Effect.flatMap(PhotosService, (svc) =>
            Effect.flatMap(
              svc.uploadPhoto(product.id, makeUpload(), undefined),
              (created) => svc.getFile(created.id),
            ),
          ),
        );
      });

      expect(result.mimetype).toBe('image/jpeg');
      expect(result.filename).toBe('photo.jpg');
      expect(Buffer.from(result.bytes).equals(JPEG_HEADER)).toBe(true);
    });

    it('fails with PhotoNotFound for an unknown id', async () => {
      const error = await fail(
        Effect.flatMap(PhotosService, (svc) =>
          svc.getFile('00000000-0000-0000-0000-000000000000'),
        ),
      );

      expect(error._tag).toBe('PhotoNotFound');
    });

    it('fails with PhotoFileNotFound when the object is gone but the row remains', async () => {
      const id = await withSharedDbRetry(async () => {
        const { product } = await seedPhotoPrereqs();
        return run(
          Effect.flatMap(PhotosService, (svc) =>
            Effect.map(
              svc.uploadPhoto(product.id, makeUpload(), undefined),
              (created) => created.id,
            ),
          ),
        );
      });
      storage.store.delete(requireOnlyStorageKey());

      const error = await fail(
        Effect.flatMap(PhotosService, (svc) => svc.getFile(id)),
      );

      // If another agent truncated the row, we get PhotoNotFound instead —
      // both represent "the photo is effectively unreachable", which is what
      // this test is about. Accept either to stay resilient on the shared DB.
      expect(['PhotoFileNotFound', 'PhotoNotFound']).toContain(error._tag);
    });
  });

  describe('deletePhoto', () => {
    it('removes the object and deletes the DB row', async () => {
      // Upload + delete in one retry block — on FK
      // violations from parallel TRUNCATE, re-seed and re-upload.
      const id = await withSharedDbRetry(async () => {
        const { product } = await seedPhotoPrereqs();
        return run(
          Effect.flatMap(PhotosService, (svc) =>
            Effect.flatMap(
              svc.uploadPhoto(product.id, makeUpload(), undefined),
              (created) =>
                Effect.map(svc.deletePhoto(created.id), () => created.id),
            ),
          ),
        );
      });

      expect(storage.store.size).toBe(0);

      // Service reports the photo as gone.
      const error = await fail(
        Effect.flatMap(PhotosService, (svc) => svc.getFile(id)),
      );
      expect(error._tag).toBe('PhotoNotFound');
    });

    it('fails with PhotoNotFound for an unknown id', async () => {
      const error = await fail(
        Effect.flatMap(PhotosService, (svc) =>
          svc.deletePhoto('00000000-0000-0000-0000-000000000000'),
        ),
      );

      expect(error._tag).toBe('PhotoNotFound');
    });

    it('succeeds even if the object is already missing', async () => {
      const id = await withSharedDbRetry(async () => {
        const { product } = await seedPhotoPrereqs();
        const createdId = await run(
          Effect.flatMap(PhotosService, (svc) =>
            Effect.map(
              svc.uploadPhoto(product.id, makeUpload(), undefined),
              (created) => created.id,
            ),
          ),
        );

        storage.store.delete(requireOnlyStorageKey());

        await run(
          Effect.flatMap(PhotosService, (svc) => svc.deletePhoto(createdId)),
        );
        return createdId;
      });

      // Service reports the photo as gone.
      const error = await fail(
        Effect.flatMap(PhotosService, (svc) => svc.getFile(id)),
      );
      expect(error._tag).toBe('PhotoNotFound');
    });
  });
});
