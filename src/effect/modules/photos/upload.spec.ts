import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { makeInMemoryStorageAdapter } from '../../platform/storage';
import { PhotosInfrastructureError } from './photos.errors';
import { makePhotoUploadWorkflow, type PhotoUploadRepository } from './upload';
import type { PhotoCreateValues, PhotoEntity, UploadedFile } from './types';

const now = new Date('2026-03-01T00:00:00.000Z');
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

const makePhoto = (overrides: Partial<PhotoEntity> = {}): PhotoEntity => ({
  id: 'photo-1',
  product_id: 'product-1',
  filename: 'label.jpg',
  mimetype: 'image/jpeg',
  size: JPEG_HEADER.length,
  storage_path: 'products/product-1/photos/object-1.jpg',
  display_order: 0,
  uploaded_by: null,
  source_hash: null,
  created_at: now,
  ...overrides,
});

const makeUpload = (overrides: Partial<UploadedFile> = {}): UploadedFile => ({
  originalname: 'label.jpg',
  mimetype: 'image/jpeg',
  size: JPEG_HEADER.length,
  buffer: JPEG_HEADER,
  ...overrides,
});

const makeRepository = (
  overrides: Partial<PhotoUploadRepository> = {},
): PhotoUploadRepository => ({
  countByProductId: () => Effect.succeed(2),
  create: (values) =>
    Effect.succeed(
      makePhoto({
        ...values,
        id: 'photo-created',
        created_at: now,
      }),
    ),
  createIdempotent: (values) =>
    Effect.succeed({
      photo: makePhoto({
        ...values,
        id: 'photo-created',
        created_at: now,
      }),
      created: true,
    }),
  findByProductSourceHash: () => Effect.succeed(null),
  ...overrides,
});

describe('makePhotoUploadWorkflow', () => {
  it.effect('writes storage, inserts metadata, and returns the photo DTO', () =>
    Effect.gen(function* () {
      let capturedCreate: PhotoCreateValues | undefined;
      const storage = makeInMemoryStorageAdapter();
      const repository = makeRepository({
        create: (values) =>
          Effect.sync(() => {
            capturedCreate = values;
            return makePhoto({
              ...values,
              id: 'photo-created',
              created_at: now,
            });
          }),
      });
      const workflow = makePhotoUploadWorkflow({
        repository,
        storage,
        makeObjectId: () => 'object-1',
      });

      const result = yield* workflow.uploadPhoto(
        'product-1',
        makeUpload(),
        'user-1',
      );

      expect(capturedCreate).toEqual({
        product_id: 'product-1',
        filename: 'label.jpg',
        mimetype: 'image/jpeg',
        size: JPEG_HEADER.length,
        storage_path: 'products/product-1/photos/object-1.jpg',
        display_order: 2,
        uploaded_by: 'user-1',
        source_hash: null,
      });
      expect(
        storage.store
          .get('products/product-1/photos/object-1.jpg')
          ?.equals(JPEG_HEADER),
      ).toBe(true);
      expect(result).toMatchObject({
        id: 'photo-created',
        filename: 'label.jpg',
        display_order: 2,
        uploaded_by: 'user-1',
      });
    }),
  );

  it.effect(
    'returns an existing source-key photo without writing storage',
    () =>
      Effect.gen(function* () {
        const storage = makeInMemoryStorageAdapter();
        const repository = makeRepository({
          findByProductSourceHash: () =>
            Effect.succeed(makePhoto({ id: 'existing-photo' })),
        });
        const workflow = makePhotoUploadWorkflow({
          repository,
          storage,
          makeObjectId: () => 'object-1',
        });

        const result = yield* workflow.uploadPhoto(
          'product-1',
          makeUpload(),
          'user-1',
          { sourceKey: 'lnk.sortly.co/photo-1' },
        );

        expect(result).toMatchObject({ id: 'existing-photo' });
        expect(storage.store.size).toBe(0);
      }),
  );

  it.effect(
    'deletes the uploaded object when another insert wins the race',
    () =>
      Effect.gen(function* () {
        const storage = makeInMemoryStorageAdapter();
        const repository = makeRepository({
          createIdempotent: () =>
            Effect.succeed({
              photo: makePhoto({ id: 'existing-photo' }),
              created: false,
            }),
        });
        const workflow = makePhotoUploadWorkflow({
          repository,
          storage,
          makeObjectId: () => 'object-1',
        });

        const result = yield* workflow.uploadPhoto(
          'product-1',
          makeUpload(),
          'user-1',
          { sourceKey: 'lnk.sortly.co/photo-1' },
        );

        expect(result).toMatchObject({ id: 'existing-photo' });
        expect(storage.store.size).toBe(0);
      }),
  );

  it.effect(
    'rejects files whose bytes do not match the declared MIME type',
    () =>
      Effect.gen(function* () {
        const storage = makeInMemoryStorageAdapter();
        let createCalled = false;
        const workflow = makePhotoUploadWorkflow({
          repository: makeRepository({
            create: () =>
              Effect.sync(() => {
                createCalled = true;
                return makePhoto();
              }),
          }),
          storage,
          makeObjectId: () => 'object-1',
        });

        const error = yield* Effect.flip(
          workflow.uploadPhoto(
            'product-1',
            makeUpload({ buffer: Buffer.from('not an image') }),
            'user-1',
          ),
        );

        expect(error).toMatchObject({ _tag: 'InvalidPhotoMimeType' });
        expect(createCalled).toBe(false);
        expect(storage.store.size).toBe(0);
      }),
  );

  it.effect('removes the stored object when metadata insertion fails', () =>
    Effect.gen(function* () {
      const storage = makeInMemoryStorageAdapter();
      const workflow = makePhotoUploadWorkflow({
        repository: makeRepository({
          create: () =>
            Effect.fail(
              new PhotosInfrastructureError({
                action: 'create photo',
                messageKey: 'photos.repositoryFailed',
              }),
            ),
        }),
        storage,
        makeObjectId: () => 'object-1',
      });

      const error = yield* Effect.flip(
        workflow.uploadPhoto('product-1', makeUpload(), 'user-1'),
      );

      expect(error).toMatchObject({ _tag: 'PhotosInfrastructureError' });
      expect(storage.store.size).toBe(0);
    }),
  );
});
