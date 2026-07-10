import { Effect } from 'effect';
import type { PhotoResponseDto } from '@stocket/types/photos';
import type { StorageAdapter } from '../../platform/storage';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import {
  created,
  retainOnCreate,
  type CreateOrReuseResult,
} from '../../platform/effect/create-or-reuse';
import {
  InvalidPhotoMimeType,
  PhotoTooLarge,
  type PhotosInfrastructureError,
} from './photos.errors';
import {
  hashPhotoSourceKey,
  makePhotoObjectKey,
  matchesMagicBytes,
  toPhotoCreateValues,
} from './photos.utils';
import { toPhotoResponseDto } from './mappers';
import { mapPhotoStorageWriteError } from './storage-errors';
import type {
  IdempotentPhotoCreateValues,
  PhotoCreateValues,
  PhotoEntity,
  PhotoUploadOptions,
  UploadedFile,
} from './types';
import { ALLOWED_PHOTO_MIME_TYPES, MAX_PHOTO_FILE_SIZE } from './types';

export interface PhotoUploadRepository {
  readonly countByProductId: (
    productId: string,
  ) => Effect.Effect<number, PhotosInfrastructureError | TenantNotResolved>;
  readonly create: (
    values: PhotoCreateValues,
  ) => Effect.Effect<
    PhotoEntity,
    PhotosInfrastructureError | TenantNotResolved
  >;
  readonly createIdempotent: (
    values: IdempotentPhotoCreateValues,
  ) => Effect.Effect<
    CreateOrReuseResult<PhotoEntity>,
    PhotosInfrastructureError | TenantNotResolved
  >;
  readonly findByProductSourceHash: (
    productId: string,
    sourceHash: string,
  ) => Effect.Effect<
    PhotoEntity | null,
    PhotosInfrastructureError | TenantNotResolved
  >;
}

interface PhotoUploadWorkflowOptions {
  readonly repository: PhotoUploadRepository;
  readonly storage: Pick<StorageAdapter, 'putObject' | 'deleteObject'>;
  readonly makeObjectId: () => string;
}

const invalidMimeType = (mimetype: string) =>
  new InvalidPhotoMimeType({
    mimetype,
    messageKey: 'photos.invalidMimeType',
    messageArgs: { allowedTypes: ALLOWED_PHOTO_MIME_TYPES.join(', ') },
  });

const isAllowedPhotoMimeType = (mimetype: string): boolean =>
  ALLOWED_PHOTO_MIME_TYPES.some((allowedType) => allowedType === mimetype);

const validateUploadedPhoto = (
  file: UploadedFile,
): Effect.Effect<void, InvalidPhotoMimeType | PhotoTooLarge> =>
  Effect.gen(function* () {
    if (!isAllowedPhotoMimeType(file.mimetype)) {
      return yield* Effect.fail(invalidMimeType(file.mimetype));
    }

    if (!matchesMagicBytes(file.buffer, file.mimetype)) {
      return yield* Effect.fail(invalidMimeType(file.mimetype));
    }

    if (file.size > MAX_PHOTO_FILE_SIZE) {
      return yield* Effect.fail(
        new PhotoTooLarge({
          size: file.size,
          maxSize: MAX_PHOTO_FILE_SIZE,
          messageKey: 'photos.tooLarge',
          messageArgs: { maxSize: MAX_PHOTO_FILE_SIZE },
        }),
      );
    }
  });

export const makePhotoUploadWorkflow = ({
  repository,
  storage,
  makeObjectId,
}: PhotoUploadWorkflowOptions) => {
  const uploadPhoto = (
    productId: string,
    file: UploadedFile,
    userId?: string,
    options: PhotoUploadOptions = {},
  ): Effect.Effect<
    PhotoResponseDto,
    | InvalidPhotoMimeType
    | PhotoTooLarge
    | PhotosInfrastructureError
    | TenantNotResolved
  > =>
    Effect.gen(function* () {
      yield* validateUploadedPhoto(file);

      const sourceKey = options.sourceKey?.trim() || null;
      const sourceHash =
        sourceKey === null ? null : hashPhotoSourceKey(sourceKey);
      if (sourceHash !== null) {
        const existing = yield* repository.findByProductSourceHash(
          productId,
          sourceHash,
        );
        if (existing !== null) return toPhotoResponseDto(existing);
      }

      const objectKey = makePhotoObjectKey(
        productId,
        makeObjectId(),
        file.mimetype,
      );

      yield* storage
        .putObject(objectKey, file.buffer, { contentType: file.mimetype })
        .pipe(Effect.mapError(mapPhotoStorageWriteError));

      const photo = yield* Effect.gen(function* () {
        const existingCount = yield* repository.countByProductId(productId);
        const values = toPhotoCreateValues({
          productId,
          file,
          objectKey,
          displayOrder: existingCount,
          userId,
          sourceHash,
        });
        if (sourceHash === null) {
          return yield* repository.create(values).pipe(Effect.map(created));
        }

        return yield* repository.createIdempotent({
          ...values,
          source_hash: sourceHash,
        });
      }).pipe((claim) =>
        retainOnCreate(claim, storage.deleteObject(objectKey)),
      );

      return toPhotoResponseDto(photo);
    });

  return { uploadPhoto };
};
