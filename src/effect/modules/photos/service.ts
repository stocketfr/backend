import * as crypto from 'node:crypto';
import { Effect } from 'effect';
import type { PhotoResponseDto } from '@stocket/types/photos';
import { fromNullOr } from '../../platform/effect/from-null-or';
import {
  StorageAdapter,
  StorageObjectNotFound,
  type StorageError,
} from '../../platform/storage';
import { toPhotoResponseDto } from './photos.utils';
import {
  InvalidPhotoMimeType,
  PhotoFileNotFound,
  PhotoNotFound,
  PhotoTooLarge,
  PhotosInfrastructureError,
} from './photos.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { PhotosRepository } from './repository';

const ALLOWED_MIMETYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const MIME_EXT_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const MAGIC_SIGNATURES: Record<string, { bytes: number[]; offset: number }[]> =
  {
    'image/jpeg': [{ bytes: [0xff, 0xd8, 0xff], offset: 0 }],
    'image/png': [{ bytes: [0x89, 0x50, 0x4e, 0x47], offset: 0 }],
    'image/gif': [{ bytes: [0x47, 0x49, 0x46, 0x38], offset: 0 }],
    'image/webp': [
      { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
      { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
    ],
  };

function matchesMagicBytes(buffer: Buffer, declaredMime: string): boolean {
  const signatures = MAGIC_SIGNATURES[declaredMime];
  if (!signatures) return false;

  return signatures.every(({ bytes, offset }) =>
    bytes.every((byte, i) => buffer[offset + i] === byte),
  );
}

export interface UploadedFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

export interface PhotoUploadOptions {
  readonly sourceUrl?: string | null;
}

const hashSourceUrl = (sourceUrl: string): string =>
  crypto.createHash('sha256').update(sourceUrl.trim()).digest('hex');

export class PhotosService extends Effect.Service<PhotosService>()(
  '@stocket/effect/photos/PhotosService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* PhotosRepository;
      const storage = yield* StorageAdapter;

      const getExtFromMime = (mimetype: string): string =>
        MIME_EXT_MAP[mimetype] ?? '.bin';

      const findPhotoOrFail = (id: string) =>
        fromNullOr(
          repository.findById(id),
          () => new PhotoNotFound({ id, messageKey: 'photos.notFound' }),
        );

      const mapStorageWriteError = (cause: StorageError) =>
        new PhotosInfrastructureError({
          action: 'write photo object',
          cause,
          messageKey: 'photos.writeFailed',
        });

      const mapStorageReadError = (cause: StorageError) =>
        new PhotosInfrastructureError({
          action: 'read photo object',
          cause,
          messageKey: 'photos.readFailed',
        });

      const mapStorageDeleteError = (cause: StorageError) =>
        new PhotosInfrastructureError({
          action: 'delete photo object',
          cause,
          messageKey: 'photos.deleteFailed',
        });

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
      > => {
        if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
          return Effect.fail(
            new InvalidPhotoMimeType({
              mimetype: file.mimetype,
              messageKey: 'photos.invalidMimeType',
              messageArgs: { allowedTypes: ALLOWED_MIMETYPES.join(', ') },
            }),
          );
        }

        if (!matchesMagicBytes(file.buffer, file.mimetype)) {
          return Effect.fail(
            new InvalidPhotoMimeType({
              mimetype: file.mimetype,
              messageKey: 'photos.invalidMimeType',
              messageArgs: { allowedTypes: ALLOWED_MIMETYPES.join(', ') },
            }),
          );
        }

        if (file.size > MAX_FILE_SIZE) {
          return Effect.fail(
            new PhotoTooLarge({
              size: file.size,
              maxSize: MAX_FILE_SIZE,
              messageKey: 'photos.tooLarge',
              messageArgs: { maxSize: MAX_FILE_SIZE },
            }),
          );
        }

        const ext = getExtFromMime(file.mimetype);
        const objectKey = `products/${productId}/photos/${crypto.randomUUID()}${ext}`;
        const sourceUrl = options.sourceUrl?.trim() || null;
        const sourceHash = sourceUrl ? hashSourceUrl(sourceUrl) : null;

        return Effect.gen(function* () {
          if (sourceHash) {
            const existing = yield* repository.findByProductSourceHash(
              productId,
              sourceHash,
            );
            if (existing) return toPhotoResponseDto(existing);
          }

          yield* storage
            .putObject(objectKey, file.buffer, { contentType: file.mimetype })
            .pipe(Effect.mapError(mapStorageWriteError));

          const photo = yield* Effect.gen(function* () {
            const existingCount = yield* repository.countByProductId(productId);
            const insert = {
              product_id: productId,
              filename: file.originalname,
              mimetype: file.mimetype,
              size: file.size,
              storage_path: objectKey,
              display_order: existingCount,
              uploaded_by: userId ?? null,
              source_url: sourceUrl,
              source_hash: sourceHash,
            };

            if (!sourceHash) {
              return yield* repository.create(insert);
            }

            const result = yield* repository.createIdempotent(insert);
            if (!result.created) {
              yield* storage.deleteObject(objectKey).pipe(Effect.ignore);
            }
            return result.photo;
          }).pipe(
            Effect.tapError(() =>
              Effect.ignore(storage.deleteObject(objectKey)),
            ),
          );

          return toPhotoResponseDto(photo);
        }).pipe(
          Effect.withSpan('PhotosService.uploadPhoto', {
            attributes: { productId },
          }),
        );
      };

      const findByProductId = (
        productId: string,
      ): Effect.Effect<
        PhotoResponseDto[],
        PhotosInfrastructureError | TenantNotResolved
      > =>
        Effect.map(repository.findByProductId(productId), (photos) =>
          photos.map(toPhotoResponseDto),
        ).pipe(
          Effect.withSpan('PhotosService.findByProductId', {
            attributes: { productId },
          }),
        );

      const getFile = (
        id: string,
      ): Effect.Effect<
        { bytes: Uint8Array; mimetype: string; filename: string },
        | PhotoFileNotFound
        | PhotoNotFound
        | PhotosInfrastructureError
        | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const photo = yield* findPhotoOrFail(id);

          const stored = yield* storage.getObject(photo.storage_path).pipe(
            Effect.mapError((cause) =>
              cause instanceof StorageObjectNotFound
                ? new PhotoFileNotFound({
                    id,
                    path: photo.storage_path,
                    messageKey: 'photos.fileNotFound',
                  })
                : mapStorageReadError(cause),
            ),
          );

          return {
            bytes: stored.bytes,
            mimetype: photo.mimetype,
            filename: photo.filename,
          };
        }).pipe(
          Effect.withSpan('PhotosService.getFile', { attributes: { id } }),
        );

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
            .pipe(Effect.mapError(mapStorageDeleteError));
          yield* repository.delete(id);
        }).pipe(
          Effect.withSpan('PhotosService.deletePhoto', { attributes: { id } }),
        );

      return { uploadPhoto, findByProductId, getFile, deletePhoto };
    }),
    dependencies: [PhotosRepository.Default],
  },
) {}
