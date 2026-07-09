import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit-scope tests for the photos HTTP boundary.
 *
 * Covers both `productPhotosRouter` (nested under `/products`) and
 * `photosRouter` (top-level `/photos`). Service internals live in
 * `service.spec.ts`.
 *
 * Canonical coverage per route:
 *   1. Permission guard rejects insufficient role → 403
 *   2. Decode failure on malformed body / params → 400
 *   3. Service success → correct status + payload shape
 *   4. Service tagged error → mapped HTTP status (404, 400, 500)
 *
 * ## Multipart upload
 *
 * The real `HttpServerRequest.schemaBodyMultipart` requires `FileSystem`
 * and `Path` services, writes temp files to disk, and streams the
 * request body. That's too heavy for a router-boundary unit test. We
 * short-circuit by replacing `@effect/platform`'s `schemaBodyMultipart`
 * with a stub controlled via `mockMultipart` — each test swaps in the
 * Effect that would otherwise be produced by decoding. The uploaded
 * `PersistedFile.path` is a fictional path; `node:fs/promises` is
 * mocked so `readFile`/`stat` don't hit the disk.
 */
import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import {
  InvalidPhotoMimeType,
  PhotoFileNotFound,
  PhotoNotFound,
  PhotoTooLarge,
  PhotosInfrastructureError,
} from './photos.errors';
import { makePhotosRouterHarness } from './__fixtures__/router-harness';
import { PhotosService, type UploadedFile } from './service';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports that use them are resolved.
// ---------------------------------------------------------------------------
const mockMultipart = vi.fn();

vi.mock('@effect/platform', async () => {
  const actual =
    await vi.importActual<typeof import('@effect/platform')>(
      '@effect/platform',
    );
  const { Effect } = await vi.importActual<typeof import('effect')>('effect');

  return {
    ...actual,
    HttpServerRequest: {
      ...actual.HttpServerRequest,
      // The real schemaBodyMultipart pulls FileSystem + Path services and
      // streams the request body. We substitute a single settable Effect
      // so tests can inject either a successful parse result or a decode
      // failure.
      schemaBodyMultipart: (_schema: unknown) =>
        Effect.suspend(() => mockMultipart()),
    },
  };
});

const mockReadFile = vi.fn();
const mockStat = vi.fn();

vi.mock('node:fs/promises', async () => {
  const actual =
    await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    );
  return {
    ...actual,
    readFile: (...args: unknown[]) => mockReadFile(...args),
    stat: (...args: unknown[]) => mockStat(...args),
  };
});

vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');
  return {
    PhotosService: Context.GenericTag('@stocket/test/PhotosService'),
    photosLayer: Layer.empty,
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const PHOTO_ID = '22222222-2222-4222-8222-222222222222';

const makePhotoResponse = (overrides: Record<string, unknown> = {}) => ({
  id: PHOTO_ID,
  product_id: PRODUCT_ID,
  filename: 'hero.png',
  mimetype: 'image/png',
  size: 1234,
  storage_path: 'products/product-1/photos/hero.png',
  display_order: 0,
  uploaded_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const makePersistedFile = (overrides: Record<string, unknown> = {}) => ({
  _tag: 'PersistedFile' as const,
  key: 'file',
  name: 'hero.png',
  contentType: 'image/png',
  path: '/tmp/fake-upload-path',
  ...overrides,
});

const writeAll = {
  [Resource.PRODUCTS]: [Permission.READ, Permission.WRITE],
};
const readOnly = {
  [Resource.PRODUCTS]: [Permission.READ],
};

describe('photos routers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue(Buffer.from('fake-image-bytes'));
    mockStat.mockResolvedValue({ size: 1234 });
  });

  // -------------------------------------------------------------------
  // POST /products/:productId/photos — upload
  // -------------------------------------------------------------------
  describe('POST /products/:productId/photos', () => {
    it('rejects without PRODUCTS:write permission', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({ file: makePersistedFile() }),
      );
      const { handler } = makePhotosRouterHarness({
        service: { uploadPhoto: () => Effect.succeed(makePhotoResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}/photos`, {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(403);
    });

    it('returns 400 when the multipart body fails schema decode', async () => {
      // Simulate schema decode failure — `Multipart.SingleFileSchema`
      // expects exactly one file, but the client sent zero.
      const { Schema, Effect } =
        await vi.importActual<typeof import('effect')>('effect');
      const emptyError = Schema.decodeUnknown(
        Schema.Struct({ file: Schema.String }),
      )({}).pipe(Effect.flip, Effect.runSync);
      mockMultipart.mockReturnValue(Effect.fail(emptyError));

      const { handler } = makePhotosRouterHarness({
        service: {
          uploadPhoto: () => Effect.die('service should not be called'),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}/photos`, {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(400);
    });

    it('returns 400 when productId is not a UUID', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({ file: makePersistedFile() }),
      );
      const { handler } = makePhotosRouterHarness({
        service: {
          uploadPhoto: () => Effect.die('service should not be called'),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/not-a-uuid/photos', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(400);
    });

    it('returns 201 with the created photo on success', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({ file: makePersistedFile() }),
      );
      const uploadPhoto = vi.fn(
        (_productId: string, _file: UploadedFile, _userId?: string) =>
          Effect.succeed(makePhotoResponse()),
      );
      const { handler } = makePhotosRouterHarness({
        service: { uploadPhoto },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}/photos`, {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({ id: PHOTO_ID });
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
      const [callProductId, uploadedFile] = uploadPhoto.mock.calls[0]!;
      expect(callProductId).toBe(PRODUCT_ID);
      expect(uploadedFile).toMatchObject({
        originalname: 'hero.png',
        mimetype: 'image/png',
        size: 1234,
      });
      expect(Buffer.isBuffer(uploadedFile.buffer)).toBe(true);
    });

    it('maps InvalidPhotoMimeType → 400', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile({ contentType: 'image/bmp' }),
        }),
      );
      const { handler } = makePhotosRouterHarness({
        service: {
          uploadPhoto: () =>
            Effect.fail(
              new InvalidPhotoMimeType({
                mimetype: 'image/bmp',
                messageKey: 'photos.invalidMimeType',
              }),
            ),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}/photos`, {
          method: 'POST',
          body: 'ignored',
        }),
      );
      expect(response.status).toBe(400);
    });

    it('maps PhotoTooLarge → 400', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({ file: makePersistedFile() }),
      );
      const { handler } = makePhotosRouterHarness({
        service: {
          uploadPhoto: () =>
            Effect.fail(
              new PhotoTooLarge({
                size: 99_999_999,
                maxSize: 10_485_760,
                messageKey: 'photos.tooLarge',
              }),
            ),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}/photos`, {
          method: 'POST',
          body: 'ignored',
        }),
      );
      expect(response.status).toBe(400);
    });

    it('maps an fs read failure → 500', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({ file: makePersistedFile() }),
      );
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      const uploadPhoto = vi.fn(() => Effect.succeed(makePhotoResponse()));
      const { handler } = makePhotosRouterHarness({
        service: {
          uploadPhoto,
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}/photos`, {
          method: 'POST',
          body: 'ignored',
        }),
      );
      expect(response.status).toBe(500);
      expect(uploadPhoto).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // GET /products/:productId/photos — list for product
  // -------------------------------------------------------------------
  describe('GET /products/:productId/photos', () => {
    it('rejects without PRODUCTS:read permission', async () => {
      const { handler } = makePhotosRouterHarness({
        service: { findByProductId: () => Effect.succeed([]) },
        permissions: {},
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}/photos`),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when productId is not a UUID', async () => {
      const { handler } = makePhotosRouterHarness({
        service: { findByProductId: () => Effect.succeed([]) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products/not-a-uuid/photos'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the photo list on success', async () => {
      const findByProductId = vi.fn(() =>
        Effect.succeed([makePhotoResponse()]),
      );
      const { handler } = makePhotosRouterHarness({
        service: { findByProductId },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}/photos`),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id: PHOTO_ID });
      expect(findByProductId).toHaveBeenCalledWith(PRODUCT_ID);
    });

    it('maps infrastructure failure → 500', async () => {
      const { handler } = makePhotosRouterHarness({
        service: {
          findByProductId: () =>
            Effect.fail(
              new PhotosInfrastructureError({
                action: 'findByProductId',
                messageKey: 'photos.repositoryFailed',
              }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}/photos`),
      );
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // GET /photos/:id/file — read object bytes
  // -------------------------------------------------------------------
  describe('GET /photos/:id/file', () => {
    it('rejects without PRODUCTS:read permission', async () => {
      const { handler } = makePhotosRouterHarness({
        service: {
          getFile: () =>
            Effect.succeed({
              bytes: Buffer.from('image-bytes'),
              mimetype: 'image/png',
              filename: 'hero.png',
            }),
        },
        permissions: {},
      });

      const response = await handler(
        new Request(`http://localhost/photos/${PHOTO_ID}/file`),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when id is not a UUID', async () => {
      const { handler } = makePhotosRouterHarness({
        service: {
          getFile: () => Effect.die('service should not be called'),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/photos/not-a-uuid/file'),
      );
      expect(response.status).toBe(400);
    });

    it('returns bytes and image headers on success', async () => {
      const getFile = vi.fn(() =>
        Effect.succeed({
          bytes: Buffer.from('image-bytes'),
          mimetype: 'image/png',
          filename: 'hero.png',
        }),
      );
      const { handler } = makePhotosRouterHarness({
        service: { getFile },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/photos/${PHOTO_ID}/file`),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe(
        'private, max-age=86400',
      );
      expect(response.headers.get('content-disposition')).toBe(
        'inline; filename="hero.png"',
      );
      await expect(response.text()).resolves.toBe('image-bytes');
      expect(getFile).toHaveBeenCalledWith(PHOTO_ID);
    });

    it('maps PhotoNotFound → 404', async () => {
      const { handler } = makePhotosRouterHarness({
        service: {
          getFile: (id: string) =>
            Effect.fail(
              new PhotoNotFound({ id, messageKey: 'photos.notFound' }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/photos/${PHOTO_ID}/file`),
      );
      expect(response.status).toBe(404);
    });

    it('maps PhotoFileNotFound → 404', async () => {
      const { handler } = makePhotosRouterHarness({
        service: {
          getFile: (id: string) =>
            Effect.fail(
              new PhotoFileNotFound({
                id,
                path: '/missing/file',
                messageKey: 'photos.fileNotFound',
              }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/photos/${PHOTO_ID}/file`),
      );
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // DELETE /photos/:id
  // -------------------------------------------------------------------
  describe('DELETE /photos/:id', () => {
    it('rejects without PRODUCTS:write permission', async () => {
      const { handler } = makePhotosRouterHarness({
        service: { deletePhoto: () => Effect.void },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/photos/${PHOTO_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when id is not a UUID', async () => {
      const { handler } = makePhotosRouterHarness({
        service: { deletePhoto: () => Effect.void },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/photos/not-a-uuid', {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 with a message body on success', async () => {
      const deletePhoto = vi.fn(() => Effect.void);
      const { handler } = makePhotosRouterHarness({
        service: { deletePhoto },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/photos/${PHOTO_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toHaveProperty('message');
      expect(deletePhoto).toHaveBeenCalledWith(PHOTO_ID);
    });

    it('maps PhotoNotFound → 404', async () => {
      const { handler } = makePhotosRouterHarness({
        service: {
          deletePhoto: (id: string) =>
            Effect.fail(
              new PhotoNotFound({ id, messageKey: 'photos.notFound' }),
            ),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/photos/${PHOTO_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(404);
    });
  });

  it('exposes the PhotosService tag', () => {
    expect(PhotosService).toBeDefined();
  });
});
