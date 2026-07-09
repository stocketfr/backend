import { describe, expect, it } from '@effect/vitest';
import { toPhotoResponseDto } from './mappers';
import type { PhotoEntity } from './types';

const createdAt = new Date('2026-01-01T00:00:00.000Z');

const photo = {
  id: '00000000-0000-4000-8000-000000000001',
  product_id: '00000000-0000-4000-8000-000000000002',
  filename: 'label.jpg',
  mimetype: 'image/jpeg',
  size: 1024,
  storage_path: 'products/product-1/photos/label.jpg',
  display_order: 2,
  uploaded_by: '00000000-0000-4000-8000-000000000003',
  created_at: createdAt,
} satisfies PhotoEntity;

describe('photo mappers', () => {
  it('maps a photo row to the public response contract', () => {
    expect(toPhotoResponseDto(photo)).toEqual({
      id: photo.id,
      product_id: photo.product_id,
      filename: 'label.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
      uploaded_by: '00000000-0000-4000-8000-000000000003',
      display_order: 2,
      created_at: createdAt,
    });
  });
});
