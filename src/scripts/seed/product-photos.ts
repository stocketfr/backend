import { Data, Effect } from 'effect';
import { photos, type products } from '../../effect/platform/db/schema';
import {
  type StorageConfigurationError,
  StorageAdapter,
  type StorageError,
  storageLayer,
} from '../../effect/platform/storage';
import { MOCK_USER_ID } from './config';
import {
  createSeedProductPng,
  hasProductPhotoStorageEnv,
  readSeedProductPhotoOptions,
  seededProductPhotoObjectKey,
  seededProductPhotoPrefix,
  seedProductPhotoFilename,
} from './product-photos.utils';
import { registry } from './registry';
import type { SeedContext } from './seeder.interface';

class SeedPhotoDatabaseError extends Data.TaggedError(
  'SeedPhotoDatabaseError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}

type ProductRow = typeof products.$inferSelect;
type SeedPhotoError =
  | StorageConfigurationError
  | StorageError
  | SeedPhotoDatabaseError;

const insertSeedPhotoRow = (
  ctx: SeedContext,
  product: ProductRow,
  key: string,
  bytes: Buffer,
) =>
  Effect.tryPromise({
    try: () =>
      ctx.db
        .insert(photos)
        .values({
          product_id: product.id,
          filename: seedProductPhotoFilename(product),
          mimetype: 'image/png',
          size: bytes.length,
          storage_path: key,
          display_order: 0,
          uploaded_by: MOCK_USER_ID,
        })
        .returning(),
    catch: (cause) =>
      new SeedPhotoDatabaseError({
        action: 'insert seed photo metadata',
        cause,
      }),
  }).pipe(Effect.asVoid);

const seedProductPhotos = (
  ctx: SeedContext,
  allProducts: readonly ProductRow[],
): Effect.Effect<number, SeedPhotoError, StorageAdapter> =>
  Effect.gen(function* () {
    const storage = yield* StorageAdapter;
    const prefix = seededProductPhotoPrefix(ctx.tenant.id);

    yield* storage.deletePrefix(prefix);

    let created = 0;
    for (const product of allProducts) {
      const key = seededProductPhotoObjectKey(ctx.tenant.id, product.id);
      const bytes = createSeedProductPng(`${ctx.tenant.id}:${product.id}`);

      yield* storage.putObject(key, bytes, { contentType: 'image/png' });
      yield* insertSeedPhotoRow(ctx, product, key, bytes).pipe(
        Effect.tapError(() => Effect.ignore(storage.deleteObject(key))),
      );
      created++;
    }

    return created;
  });

const shouldSkipStorageError = (error: SeedPhotoError): boolean =>
  error._tag === 'StorageConfigurationError';

function throwSeedPhotoError(error: SeedPhotoError): never {
  if (error._tag === 'SeedPhotoDatabaseError') {
    throw new Error(`Failed to ${error.action}`, { cause: error.cause });
  }

  throw new Error(`Failed to seed product photos: ${error._tag}`, {
    cause: error.cause,
  });
}

registry.register({
  name: 'product-photos',
  dependencies: ['products'],
  async run(ctx) {
    const options = readSeedProductPhotoOptions();

    if (!options.enabled) {
      console.log('Skipping product photos (SEED_PRODUCT_PHOTOS=false)\n');
      return;
    }

    const allProducts = ctx.store.get('products') as ProductRow[];
    if (allProducts.length === 0) {
      console.log('Skipping product photos (no products)\n');
      return;
    }

    if (!hasProductPhotoStorageEnv()) {
      const message =
        'Skipping product photos (S3 storage env is not fully configured)';
      if (options.required) {
        throw new Error(message);
      }
      console.log(`${message}\n`);
      return;
    }

    console.log('Seeding product photos...');

    const result = await Effect.runPromise(
      seedProductPhotos(ctx, allProducts).pipe(
        Effect.provide(storageLayer),
        Effect.either,
      ),
    );

    if (result._tag === 'Left') {
      if (!options.required && shouldSkipStorageError(result.left)) {
        console.log(`  Skipped product photos (${result.left.message})\n`);
        return;
      }

      throwSeedPhotoError(result.left);
    }

    console.log(`  Created ${result.right} product photos\n`);
  },
});
