import type { PhotoResponseDto } from '@stocket/types/photos';
import type { PhotoEntity } from './types';

export function toPhotoResponseDto(photo: PhotoEntity): PhotoResponseDto {
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
