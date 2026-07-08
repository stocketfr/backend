import { readFile, stat } from 'node:fs/promises';
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  Multipart,
} from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import {
  PhotoIdSchema,
  PhotoProductIdSchema,
} from '@stocket/types/photos';
import { requirePermission } from '../../platform/auth/authorization';
import { respondCause } from '../../platform/http/errors';
import { makeMessageResponse } from '../../platform/observability/messages';
import {
  pathParams,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { PhotosInfrastructureError } from './photos.errors';
import { PhotosService } from './service';

const PhotoPathParams = Schema.Struct({ id: PhotoIdSchema });
const ProductIdPathParams = Schema.Struct({ productId: PhotoProductIdSchema });

const UploadSchema = Schema.Struct({
  file: Multipart.SingleFileSchema,
});

const readProductPhotoUpload = Effect.gen(function* () {
  const path = yield* pathParams(ProductIdPathParams);
  const parts = yield* HttpServerRequest.schemaBodyMultipart(UploadSchema);
  return { path, file: parts.file };
});

export const productPhotosRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/:productId/photos',
    tenantRoute({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: readProductPhotoUpload,
      session: 'optional',
      handler: ({ input: { path, file }, userId }) =>
        Effect.gen(function* () {
          const photosService = yield* PhotosService;

          // PersistedFile has a `path` to a temp file on disk.
          const buffer = yield* Effect.tryPromise({
            try: () => readFile(file.path),
            catch: (cause) =>
              new PhotosInfrastructureError({
                action: 'read uploaded file',
                cause,
                messageKey: 'photos.readUploadFailed',
              }),
          });
          const fileStats = yield* Effect.tryPromise({
            try: () => stat(file.path),
            catch: (cause) =>
              new PhotosInfrastructureError({
                action: 'stat uploaded file',
                cause,
                messageKey: 'photos.statUploadFailed',
              }),
          });

          return yield* photosService.uploadPhoto(
            path.productId,
            {
              originalname: file.name,
              mimetype: file.contentType,
              size: fileStats.size,
              buffer,
            },
            userId,
          );
        }),
      responseOptions: { status: 201 },
    }),
  ),
  HttpRouter.get(
    '/:productId/photos',
    tenantRoute({
      permissions: [[Resource.PRODUCTS, Permission.READ]],
      decode: pathParams(ProductIdPathParams),
      handler: ({ input: { productId } }) =>
        Effect.flatMap(PhotosService, (photosService) =>
          photosService.findByProductId(productId),
        ),
    }),
  ),
  HttpRouter.prefixAll('/products'),
);

export const photosRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/:id/file',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.READ);
      const { id } = yield* pathParams(PhotoPathParams);
      const photosService = yield* PhotosService;
      const { bytes, mimetype, filename } = yield* photosService.getFile(id);
      return HttpServerResponse.uint8Array(bytes, {
        contentType: mimetype,
        headers: {
          'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
          'Cache-Control': 'private, max-age=86400',
        },
      });
    }).pipe(Effect.catchAllCause(respondCause)),
  ),
  HttpRouter.del(
    '/:id',
    tenantRoute({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: pathParams(PhotoPathParams),
      handler: ({ input: { id } }) =>
        Effect.gen(function* () {
          const photosService = yield* PhotosService;
          yield* photosService.deletePhoto(id);
          return makeMessageResponse('photos.deleted');
        }),
    }),
  ),
  HttpRouter.prefixAll('/photos'),
);
