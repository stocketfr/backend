import { describe, expect, it } from '@effect/vitest';
import {
  getPhotoExtension,
  makePhotoObjectKey,
  matchesMagicBytes,
  toPhotoCreateValues,
} from './photos.utils';

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  Buffer.alloc(8, 0),
]);

describe('photo utils', () => {
  it('matches supported image magic bytes', () => {
    expect(matchesMagicBytes(JPEG_HEADER, 'image/jpeg')).toBe(true);
    expect(matchesMagicBytes(PNG_HEADER, 'image/png')).toBe(true);
    expect(matchesMagicBytes(Buffer.from('not an image'), 'image/jpeg')).toBe(
      false,
    );
    expect(matchesMagicBytes(JPEG_HEADER, 'text/plain')).toBe(false);
  });

  it('derives extensions and object keys from MIME type', () => {
    expect(getPhotoExtension('image/jpeg')).toBe('.jpg');
    expect(getPhotoExtension('image/png')).toBe('.png');
    expect(getPhotoExtension('application/octet-stream')).toBe('.bin');
    expect(makePhotoObjectKey('product-1', 'object-1', 'image/webp')).toBe(
      'products/product-1/photos/object-1.webp',
    );
  });

  it('maps upload state to photo create values', () => {
    const values = toPhotoCreateValues({
      productId: 'product-1',
      file: {
        originalname: 'label.jpg',
        mimetype: 'image/jpeg',
        size: JPEG_HEADER.length,
        buffer: JPEG_HEADER,
      },
      objectKey: 'products/product-1/photos/object-1.jpg',
      displayOrder: 2,
      userId: 'user-1',
    });

    expect(values).toEqual({
      product_id: 'product-1',
      filename: 'label.jpg',
      mimetype: 'image/jpeg',
      size: JPEG_HEADER.length,
      storage_path: 'products/product-1/photos/object-1.jpg',
      display_order: 2,
      uploaded_by: 'user-1',
      source_url: null,
      source_hash: null,
    });
  });
});
