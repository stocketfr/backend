import { Effect, Layer } from 'effect';
import { PhotosService, type UploadedFile } from './service';
import { PhotosRepository } from './repository';
import type { photos } from '../../platform/db/schema';
import { makeTestLayer } from '../../testing/utils';
import {
  StorageAdapter,
  makeInMemoryStorageAdapter,
  type InMemoryStorageAdapter,
} from '../../platform/storage';
import { PhotosInfrastructureError } from './photos.errors';
import { hashSourceUrl } from './photos.utils';

type PhotoEntity = typeof photos.$inferSelect;
type CreatePhotoInput = Parameters<PhotosRepository['create']>[0];
type MockPhotosRepository = Pick<
  PhotosRepository,
  | 'findByProductId'
  | 'findById'
  | 'findByProductSourceHash'
  | 'create'
  | 'createIdempotent'
  | 'delete'
  | 'countByProductId'
>;

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  Buffer.alloc(8, 0),
]);

const makePhotoEntity = (
  overrides: Partial<PhotoEntity> = {},
): PhotoEntity => ({
  id: 'photo-1',
  product_id: 'prod-1',
  filename: 'test.jpg',
  mimetype: 'image/jpeg',
  size: 1024,
  storage_path: 'products/prod-1/photos/test.jpg',
  display_order: 0,
  uploaded_by: null,
  source_url: null,
  source_hash: null,
  created_at: new Date('2026-01-01'),
  ...overrides,
});

const makeUpload = (overrides: Partial<UploadedFile> = {}): UploadedFile => ({
  originalname: 'test.jpg',
  mimetype: 'image/jpeg',
  size: JPEG_HEADER.length,
  buffer: JPEG_HEADER,
  ...overrides,
});

const makeMockRepository = (
  overrides: Partial<MockPhotosRepository> = {},
): MockPhotosRepository => {
  const findByProductId: MockPhotosRepository['findByProductId'] = vi
    .fn()
    .mockReturnValue(Effect.succeed([makePhotoEntity()]));
  const findById: MockPhotosRepository['findById'] = vi
    .fn()
    .mockReturnValue(Effect.succeed(makePhotoEntity()));
  const findByProductSourceHash: MockPhotosRepository['findByProductSourceHash'] =
    vi.fn().mockReturnValue(Effect.succeed(null));
  const create: MockPhotosRepository['create'] = vi.fn(
    (data: CreatePhotoInput) =>
      Effect.succeed(
        makePhotoEntity({
          ...data,
          id: 'photo-1',
          created_at: new Date('2026-01-01'),
        }),
      ),
  );
  const createIdempotent: MockPhotosRepository['createIdempotent'] = vi.fn(
    (data: CreatePhotoInput) =>
      Effect.succeed({
        photo: makePhotoEntity({
          ...data,
          id: 'photo-1',
          created_at: new Date('2026-01-01'),
        }),
        created: true,
      }),
  );
  const deletePhoto: MockPhotosRepository['delete'] = vi
    .fn()
    .mockReturnValue(Effect.void);
  const countByProductId: MockPhotosRepository['countByProductId'] = vi
    .fn()
    .mockReturnValue(Effect.succeed(0));

  return {
    findByProductId,
    findById,
    findByProductSourceHash,
    create,
    createIdempotent,
    delete: deletePhoto,
    countByProductId,
    ...overrides,
  };
};

const buildService = async (
  repo = makeMockRepository(),
  storage = makeInMemoryStorageAdapter(),
): Promise<{
  readonly service: PhotosService;
  readonly repository: MockPhotosRepository;
  readonly storage: InMemoryStorageAdapter;
}> => {
  const service = await Effect.runPromise(
    PhotosService.pipe(
      Effect.provide(
        PhotosService.DefaultWithoutDependencies.pipe(
          Layer.provide(
            Layer.mergeAll(
              makeTestLayer(PhotosRepository)(repo),
              Layer.succeed(StorageAdapter, storage),
            ),
          ),
        ),
      ),
    ),
  );

  return { service, repository: repo, storage };
};

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const fail = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(effect));

describe('Effect PhotosService', () => {
  describe('uploadPhoto', () => {
    it('writes a valid image to object storage and inserts metadata', async () => {
      const { service, repository, storage } = await buildService();

      const result = await run(
        service.uploadPhoto('prod-1', makeUpload(), undefined),
      );

      expect(result).toMatchObject({
        id: 'photo-1',
        filename: 'test.jpg',
        mimetype: 'image/jpeg',
        display_order: 0,
      });

      const [objectKey] = [...storage.store.keys()];
      expect(objectKey).toBeDefined();
      if (!objectKey) {
        throw new Error('expected uploaded object key');
      }
      expect(objectKey).toMatch(/^products\/prod-1\/photos\/[0-9a-f-]+\.jpg$/);
      expect(storage.store.get(objectKey)?.equals(JPEG_HEADER)).toBe(true);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          product_id: 'prod-1',
          filename: 'test.jpg',
          mimetype: 'image/jpeg',
          size: JPEG_HEADER.length,
          storage_path: objectKey,
          display_order: 0,
          uploaded_by: null,
        }),
      );
    });

    it('derives the object extension from the validated MIME type', async () => {
      const { service, storage } = await buildService();

      await run(
        service.uploadPhoto(
          'prod-1',
          makeUpload({
            originalname: 'wrong-extension.gif',
            mimetype: 'image/png',
            buffer: PNG_HEADER,
            size: PNG_HEADER.length,
          }),
          undefined,
        ),
      );

      const [objectKey] = [...storage.store.keys()];
      expect(objectKey).toBeDefined();
      if (!objectKey) {
        throw new Error('expected uploaded object key');
      }
      expect(objectKey).toMatch(/^products\/prod-1\/photos\/[0-9a-f-]+\.png$/);
    });

    it('rejects invalid mimetype before writing storage', async () => {
      const { service, storage } = await buildService();
      const error = await fail(
        service.uploadPhoto(
          'prod-1',
          makeUpload({
            originalname: 'test.txt',
            mimetype: 'text/plain',
            size: 100,
            buffer: Buffer.from('test'),
          }),
          undefined,
        ),
      );

      expect(error).toMatchObject({ _tag: 'InvalidPhotoMimeType' });
      expect(storage.store.size).toBe(0);
    });

    it('rejects oversized files before writing storage', async () => {
      const { service, storage } = await buildService();
      const error = await fail(
        service.uploadPhoto(
          'prod-1',
          makeUpload({ originalname: 'large.jpg', size: 11 * 1024 * 1024 }),
          undefined,
        ),
      );

      expect(error).toMatchObject({ _tag: 'PhotoTooLarge' });
      expect(storage.store.size).toBe(0);
    });

    it('deletes the object when metadata insertion fails', async () => {
      const repo = makeMockRepository({
        create: vi.fn(() =>
          Effect.fail(
            new PhotosInfrastructureError({
              action: 'create photo',
              messageKey: 'photos.repositoryFailed',
            }),
          ),
        ),
      });
      const { service, storage } = await buildService(repo);

      const error = await fail(
        service.uploadPhoto('prod-1', makeUpload(), undefined),
      );

      expect(error).toMatchObject({ _tag: 'PhotosInfrastructureError' });
      expect(storage.store.size).toBe(0);
    });

    it('short-circuits source URL imports when the source hash already exists', async () => {
      const sourceUrl = 'https://sortly.example/photo.jpg?token=secret';
      const existing = makePhotoEntity({ id: 'existing-photo' });
      const repo = makeMockRepository({
        findByProductSourceHash: vi.fn(() => Effect.succeed(existing)),
      });
      const { service, repository, storage } = await buildService(repo);

      const result = await run(
        service.uploadPhoto('prod-1', makeUpload(), 'user-1', { sourceUrl }),
      );

      expect(result).toMatchObject({ id: 'existing-photo' });
      expect(repository.findByProductSourceHash).toHaveBeenCalledWith(
        'prod-1',
        hashSourceUrl(sourceUrl),
      );
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.createIdempotent).not.toHaveBeenCalled();
      expect(storage.store.size).toBe(0);
    });

    it('stores only the source hash for source URL imports', async () => {
      const sourceUrl = 'https://sortly.example/photo.jpg?token=secret';
      const { service, repository } = await buildService();

      await run(
        service.uploadPhoto('prod-1', makeUpload(), 'user-1', { sourceUrl }),
      );

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.createIdempotent).toHaveBeenCalledWith(
        expect.objectContaining({
          product_id: 'prod-1',
          uploaded_by: 'user-1',
          source_url: null,
          source_hash: hashSourceUrl(sourceUrl),
        }),
      );
    });

    it('deletes the just-uploaded object when idempotent create returns an existing photo', async () => {
      const sourceUrl = 'https://sortly.example/photo.jpg?token=secret';
      const repo = makeMockRepository({
        createIdempotent: vi.fn((data: CreatePhotoInput) =>
          Effect.succeed({
            photo: makePhotoEntity({
              ...data,
              id: 'existing-photo',
              storage_path: 'products/prod-1/photos/existing.jpg',
              created_at: new Date('2026-01-01'),
            }),
            created: false,
          }),
        ),
      });
      const { service, storage } = await buildService(repo);

      const result = await run(
        service.uploadPhoto('prod-1', makeUpload(), 'user-1', { sourceUrl }),
      );

      expect(result).toMatchObject({ id: 'existing-photo' });
      expect(storage.store.size).toBe(0);
    });
  });

  describe('findByProductId', () => {
    it('returns photos for a product', async () => {
      const { service } = await buildService();
      const result = await run(service.findByProductId('prod-1'));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'photo-1' });
    });
  });

  describe('getFile', () => {
    it('returns bytes for a stored photo', async () => {
      const storage = makeInMemoryStorageAdapter({
        'products/prod-1/photos/test.jpg': JPEG_HEADER,
      });
      const { service } = await buildService(makeMockRepository(), storage);

      const result = await run(service.getFile('photo-1'));

      expect(result).toMatchObject({
        filename: 'test.jpg',
        mimetype: 'image/jpeg',
      });
      expect(Buffer.from(result.bytes).equals(JPEG_HEADER)).toBe(true);
    });

    it('fails with PhotoNotFound', async () => {
      const repo = makeMockRepository({
        findById: vi.fn().mockReturnValue(Effect.succeed(null)),
      });
      const { service } = await buildService(repo);
      const error = await fail(service.getFile('missing'));
      expect(error).toMatchObject({ _tag: 'PhotoNotFound' });
    });

    it('fails with PhotoFileNotFound when metadata points to a missing object', async () => {
      const { service } = await buildService();
      const error = await fail(service.getFile('photo-1'));
      expect(error).toMatchObject({ _tag: 'PhotoFileNotFound' });
    });
  });

  describe('deletePhoto', () => {
    it('deletes the object and metadata row', async () => {
      const storage = makeInMemoryStorageAdapter({
        'products/prod-1/photos/test.jpg': JPEG_HEADER,
      });
      const { service, repository } = await buildService(
        makeMockRepository(),
        storage,
      );

      await run(service.deletePhoto('photo-1'));

      expect(storage.store.has('products/prod-1/photos/test.jpg')).toBe(false);
      expect(repository.delete).toHaveBeenCalledWith('photo-1');
    });

    it('succeeds when the object is already missing', async () => {
      const { service, repository } = await buildService();

      await run(service.deletePhoto('photo-1'));

      expect(repository.delete).toHaveBeenCalledWith('photo-1');
    });

    it('fails with PhotoNotFound', async () => {
      const repo = makeMockRepository({
        findById: vi.fn().mockReturnValue(Effect.succeed(null)),
      });
      const { service } = await buildService(repo);
      const error = await fail(service.deletePhoto('missing'));
      expect(error).toMatchObject({ _tag: 'PhotoNotFound' });
    });
  });
});
