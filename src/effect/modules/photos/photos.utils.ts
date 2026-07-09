import * as crypto from 'node:crypto';
import type { PhotoCreateValues, PhotoCreateValuesOptions } from './types';
import { PHOTO_MAGIC_SIGNATURES, PHOTO_MIME_EXTENSIONS } from './types';

export const getPhotoExtension = (mimetype: string): string =>
  PHOTO_MIME_EXTENSIONS[mimetype] ?? '.bin';

export function matchesMagicBytes(
  buffer: Buffer,
  declaredMime: string,
): boolean {
  const signatures = PHOTO_MAGIC_SIGNATURES[declaredMime];
  if (!signatures) return false;

  return signatures.every(({ bytes, offset }) =>
    bytes.every((byte, index) => buffer[offset + index] === byte),
  );
}

export const makePhotoObjectKey = (
  productId: string,
  objectId: string,
  mimetype: string,
): string =>
  `products/${productId}/photos/${objectId}${getPhotoExtension(mimetype)}`;

export const hashPhotoSourceKey = (sourceKey: string): string =>
  crypto.createHash('sha256').update(sourceKey.trim()).digest('hex');

export const toPhotoCreateValues = ({
  productId,
  file,
  objectKey,
  displayOrder,
  userId,
  sourceHash,
}: PhotoCreateValuesOptions): PhotoCreateValues => ({
  product_id: productId,
  filename: file.originalname,
  mimetype: file.mimetype,
  size: file.size,
  storage_path: objectKey,
  display_order: displayOrder,
  uploaded_by: userId ?? null,
  source_url: null,
  source_hash: sourceHash ?? null,
});
