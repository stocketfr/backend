import { Effect } from 'effect';
import type { PhotoResponseDto } from '@stocket/types/photos';
import { PhotosService, type UploadedFile } from '../../photos/service';
import { toError } from '../../../platform/effect/to-error';
import { makeServiceTracer } from '../../../platform/observability/service-tracer';
import { isSupportedSortlyPhotoUrl } from './utils';

const MAX_REMOTE_PHOTO_SIZE = 10 * 1024 * 1024;
const PHOTO_FETCH_TIMEOUT_MS = 15_000;

const MIME_EXT_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const normalizeContentType = (value: string | null): string =>
  value?.split(';')[0]?.trim().toLowerCase() ?? '';

const makeSortlyPhotoFilename = (
  photoIndex: number,
  mimetype: string,
): string => `sortly-photo-${photoIndex + 1}${MIME_EXT_MAP[mimetype] ?? '.bin'}`;

const readRemotePhoto = (url: string, photoIndex: number) =>
  Effect.tryPromise({
    try: async (): Promise<UploadedFile> => {
      if (!isSupportedSortlyPhotoUrl(url)) {
        throw new Error(`Unsupported Sortly photo URL "${url}"`);
      }

      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(PHOTO_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(
          `Failed to download Sortly photo "${url}": ${response.status} ${response.statusText}`,
        );
      }

      const contentLength = Number.parseInt(
        response.headers.get('content-length') ?? '',
        10,
      );
      if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_REMOTE_PHOTO_SIZE
      ) {
        throw new Error(
          `Sortly photo "${url}" is larger than ${MAX_REMOTE_PHOTO_SIZE} bytes`,
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_REMOTE_PHOTO_SIZE) {
        throw new Error(
          `Sortly photo "${url}" is larger than ${MAX_REMOTE_PHOTO_SIZE} bytes`,
        );
      }

      const mimetype = normalizeContentType(response.headers.get('content-type'));
      return {
        originalname: makeSortlyPhotoFilename(photoIndex, mimetype),
        mimetype,
        size: buffer.length,
        buffer,
      };
    },
    catch: (cause) => toError('Failed to import Sortly photo', cause),
  });

export class ProductImportPhotoImporter extends Effect.Service<ProductImportPhotoImporter>()(
  '@stocket/effect/products/ProductImportPhotoImporter',
  {
    effect: Effect.gen(function* () {
      const photosService = yield* PhotosService;
      const trace = makeServiceTracer({
        serviceName: 'ProductImportPhotoImporter',
        module: 'products',
        layer: 'service',
      });

      const importSortlyPhoto = (
        productId: string,
        url: string,
        photoIndex: number,
        userId: string,
      ): Effect.Effect<PhotoResponseDto, unknown> =>
        Effect.gen(function* () {
          const file = yield* readRemotePhoto(url, photoIndex);
          return yield* photosService.uploadPhoto(productId, file, userId);
        }).pipe(trace.span('importSortlyPhoto', { attributes: { productId } }));

      return { importSortlyPhoto };
    }),
    dependencies: [PhotosService.Default],
  },
) {}
