import * as crypto from 'node:crypto';
import type { PhotoResponseDto } from '@stocket/types/photos';
import type { photos } from '../../platform/db/schema';

type Photo = typeof photos.$inferSelect;

const PHOTO_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const photoExtensionFromMime = (mimetype: string): string =>
  PHOTO_MIME_EXTENSIONS[mimetype] ?? '.bin';

export const hashSourceUrl = (sourceUrl: string): string =>
  crypto.createHash('sha256').update(sourceUrl.trim()).digest('hex');

export const makeSortlyPhotoFilename = (
  photoIndex: number,
  mimetype: string,
): string => `sortly-photo-${photoIndex + 1}${photoExtensionFromMime(mimetype)}`;

export function toPhotoResponseDto(photo: Photo): PhotoResponseDto {
  return {
    id: photo.id,
    product_id: photo.product_id,
    filename: photo.filename,
    mimetype: photo.mimetype,
    size: photo.size,
    uploaded_by: photo.uploaded_by,
    display_order: photo.display_order,
    created_at: photo.created_at,
  };
}
