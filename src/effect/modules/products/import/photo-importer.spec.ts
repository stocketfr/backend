import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { makeTestLayer } from '../../../testing/utils';
import { PhotosService } from '../../photos/service';
import { ProductImportPhotoImporter } from './photo-importer';

const existingPhoto = {
  id: 'photo-1',
  product_id: 'product-1',
  filename: 'sortly-photo-1.jpg',
  mimetype: 'image/jpeg',
  size: 4,
  uploaded_by: 'user-1',
  display_order: 0,
  created_at: new Date('2026-07-10T00:00:00.000Z'),
};

const buildImporter = (photosService: Partial<PhotosService>) =>
  Effect.runPromise(
    ProductImportPhotoImporter.pipe(
      Effect.provide(
        ProductImportPhotoImporter.DefaultWithoutDependencies.pipe(
          Layer.provide(makeTestLayer(PhotosService)(photosService)),
        ),
      ),
    ),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProductImportPhotoImporter', () => {
  it('skips the download when the canonical source already exists', async () => {
    const findBySourceKey = vi.fn(() => Effect.succeed(existingPhoto));
    const uploadPhoto = vi.fn(() => Effect.succeed(existingPhoto));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const importer = await buildImporter({ findBySourceKey, uploadPhoto });

    const result = await Effect.runPromise(
      importer.importSortlyPhoto(
        'product-1',
        'https://lnk.sortly.co/v2/downloads/photo/photo-1?token=rotated',
        0,
        'user-1',
      ),
    );

    expect(result).toEqual(existingPhoto);
    expect(findBySourceKey).toHaveBeenCalledWith(
      'product-1',
      'lnk.sortly.co/v2/downloads/photo/photo-1',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it('passes the canonical source key into a new upload', async () => {
    const findBySourceKey = vi.fn(() => Effect.succeed(null));
    const uploadPhoto = vi.fn(() => Effect.succeed(existingPhoto));
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        ),
      ),
    );
    const importer = await buildImporter({ findBySourceKey, uploadPhoto });

    await Effect.runPromise(
      importer.importSortlyPhoto(
        'product-1',
        'https://lnk.sortly.co/v2/downloads/photo/photo-1?token=temporary',
        0,
        'user-1',
      ),
    );

    expect(uploadPhoto).toHaveBeenCalledWith(
      'product-1',
      expect.objectContaining({
        originalname: 'sortly-photo-1.jpg',
        mimetype: 'image/jpeg',
      }),
      'user-1',
      { sourceKey: 'lnk.sortly.co/v2/downloads/photo/photo-1' },
    );
  });
});
