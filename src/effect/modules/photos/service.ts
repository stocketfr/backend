import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import type { PhotoResponseDto } from '@stocket/types/photos';
import { fromNullOr } from '../../platform/effect/from-null-or';
import { StorageAdapter } from '../../platform/storage';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { toPhotoResponseDto } from './mappers';
import {
  type InvalidPhotoMimeType,
  PhotoFileNotFound,
  PhotoNotFound,
  type PhotoTooLarge,
  type PhotosInfrastructureError,
} from './photos.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { PhotosRepository } from './repository';
import type { PhotoFileResult, UploadedFile } from './types';
import { makePhotoUploadWorkflow } from './upload';
import {
  mapPhotoStorageDeleteError,
  mapPhotoStorageReadError,
} from './storage-errors';

export class PhotosService extends Effect.Service<PhotosService>()(
  '@stocket/effect/photos/PhotosService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* PhotosRepository;
      const storage = yield* StorageAdapter;
      const trace = makeServiceTracer({
        serviceName: 'PhotosService',
        module: 'photos',
        layer: 'service',
      });

      const findPhotoOrFail = (id: string) =>
        fromNullOr(
          repository.findById(id),
          () => new PhotoNotFound({ id, messageKey: 'photos.notFound' }),
        );

      const photoUploadWorkflow = makePhotoUploadWorkflow({
        repository,
        storage,
        makeObjectId: randomUUID,
      });

      const uploadPhoto = (
        productId: string,
        file: UploadedFile,
        userId?: string,
      ): Effect.Effect<
        PhotoResponseDto,
        | InvalidPhotoMimeType
        | PhotoTooLarge
        | PhotosInfrastructureError
        | TenantNotResolved
      > =>
        photoUploadWorkflow
          .uploadPhoto(productId, file, userId)
          .pipe(trace.span('uploadPhoto', { attributes: { productId } }));

      const findByProductId = (
        productId: string,
      ): Effect.Effect<
        PhotoResponseDto[],
        PhotosInfrastructureError | TenantNotResolved
      > =>
        Effect.map(repository.findByProductId(productId), (photos) =>
          photos.map(toPhotoResponseDto),
        ).pipe(trace.span('findByProductId', { attributes: { productId } }));

      const getFile = (
        id: string,
      ): Effect.Effect<
        PhotoFileResult,
        | PhotoFileNotFound
        | PhotoNotFound
        | PhotosInfrastructureError
        | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const photo = yield* findPhotoOrFail(id);

          const stored = yield* storage.getObject(photo.storage_path).pipe(
            Effect.catchTag('StorageObjectNotFound', () =>
              Effect.fail(
                new PhotoFileNotFound({
                  id,
                  path: photo.storage_path,
                  messageKey: 'photos.fileNotFound',
                }),
              ),
            ),
            Effect.catchTag('StorageError', (cause) =>
              Effect.fail(mapPhotoStorageReadError(cause)),
            ),
          );

          return {
            bytes: stored.bytes,
            mimetype: photo.mimetype,
            filename: photo.filename,
          };
        }).pipe(trace.span('getFile', { attributes: { id } }));

      const deletePhoto = (
        id: string,
      ): Effect.Effect<
        void,
        PhotoNotFound | PhotosInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const photo = yield* findPhotoOrFail(id);
          yield* storage
            .deleteObject(photo.storage_path)
            .pipe(Effect.mapError(mapPhotoStorageDeleteError));
          yield* repository.delete(id);
        }).pipe(trace.span('deletePhoto', { attributes: { id } }));

      return { uploadPhoto, findByProductId, getFile, deletePhoto };
    }),
    dependencies: [PhotosRepository.Default],
  },
) {}
