import { describe, expect, it } from 'vitest';
import {
  createSeedProductPng,
  hasProductPhotoStorageEnv,
  readSeedProductPhotoOptions,
  seededProductPhotoObjectKey,
  seededProductPhotoPrefix,
} from './product-photos.utils';

describe('product photo seed utilities', () => {
  it('creates deterministic PNG bytes from a seed', () => {
    const first = createSeedProductPng('product-1', 16, 12);
    const second = createSeedProductPng('product-1', 16, 12);
    const third = createSeedProductPng('product-2', 16, 12);

    expect(first.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(first.equals(second)).toBe(true);
    expect(first.equals(third)).toBe(false);
  });

  it('builds tenant-scoped seeded photo object keys', () => {
    expect(seededProductPhotoPrefix('tenant-1')).toBe(
      'seed/product-photos/tenant-1/',
    );
    expect(seededProductPhotoObjectKey('tenant-1', 'product-1')).toBe(
      'seed/product-photos/tenant-1/product-1/photo-0.png',
    );
  });

  it('reads product photo seed options from environment flags', () => {
    expect(readSeedProductPhotoOptions({})).toEqual({
      enabled: true,
      required: false,
    });
    expect(
      readSeedProductPhotoOptions({
        SEED_PRODUCT_PHOTOS: 'false',
        SEED_PRODUCT_PHOTOS_REQUIRED: '1',
      }),
    ).toEqual({
      enabled: false,
      required: true,
    });
  });

  it('checks that all S3 storage env values are present', () => {
    expect(hasProductPhotoStorageEnv({})).toBe(false);
    expect(
      hasProductPhotoStorageEnv({
        S3_ENDPOINT: 'http://localhost:9000',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: 'minio',
        S3_SECRET_ACCESS_KEY: 'minio123',
        S3_BUCKET: 'stocket-local',
        S3_FORCE_PATH_STYLE: 'true',
      }),
    ).toBe(true);
  });
});
