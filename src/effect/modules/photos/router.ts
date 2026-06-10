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
import { requirePermission } from '../../platform/authorization';
import { respondJson, respondJsonOk, respondCause } from '../../platform/errors';
import { makeMessageResponse } from '../../platform/messages';
import { getOptionalSession } from '../../platform/session';
import { PhotosInfrastructureError } from './photos.errors';
import { PhotosService } from './service';

const PhotoPathParams = Schema.Struct({ id: PhotoIdSchema });
const ProductIdPathParams = Schema.Struct({ productId: PhotoProductIdSchema });

const UploadSchema = Schema.Struct({
  file: Multipart.SingleFileSchema,
});

export const productPhotosRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/:productId/photos',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const { productId } =
        yield* HttpRouter.schemaPathParams(ProductIdPathParams);
      const parts = yield* HttpServerRequest.schemaBodyMultipart(UploadSchema);
      const {file} = parts;
      const session = yield* getOptionalSession;
      const userId = session?.user.id;
      const photosService = yield* PhotosService;

      // PersistedFile has a `path` to a temp file on disk
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

      const result = yield* photosService.uploadPhoto(
        productId,
        {
          originalname: file.name,
          mimetype: file.contentType,
          size: fileStats.size,
          buffer,
        },
        userId,
      );

      return yield* respondJsonOk(result, { status: 201 });
    }),
  ),
  HttpRouter.get(
    '/:productId/photos',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.READ);
      const { productId } =
        yield* HttpRouter.schemaPathParams(ProductIdPathParams);
      const photosService = yield* PhotosService;
      return yield* respondJson(photosService.findByProductId(productId));
    }),
  ),
  HttpRouter.prefixAll('/products'),
);

export const photosRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/:id/file',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.READ);
      const { id } = yield* HttpRouter.schemaPathParams(PhotoPathParams);
      const photosService = yield* PhotosService;
      const { filePath, mimetype, filename } =
        yield* photosService.getFilePath(id);
      const response = yield* HttpServerResponse.file(filePath);
      return response.pipe(
        HttpServerResponse.setHeader('Content-Type', mimetype),
        HttpServerResponse.setHeader(
          'Content-Disposition',
          `inline; filename="${encodeURIComponent(filename)}"`,
        ),
        HttpServerResponse.setHeader(
          'Cache-Control',
          'private, max-age=86400',
        ),
      );
    }).pipe(Effect.catchAllCause(respondCause)),
  ),
  HttpRouter.del(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(PhotoPathParams);
      const photosService = yield* PhotosService;
      yield* photosService.deletePhoto(id);
      return yield* respondJson(
        Effect.succeed(makeMessageResponse('photos.deleted')),
      );
    }),
  ),
  HttpRouter.prefixAll('/photos'),
);
