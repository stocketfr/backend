import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import type { products } from '../../effect/platform/db/schema';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export interface SeedProductPhotoOptions {
  readonly enabled: boolean;
  readonly required: boolean;
}

export const PRODUCT_PHOTO_STORAGE_ENV_KEYS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'S3_FORCE_PATH_STYLE',
] as const;

function parseOptionalBoolean(
  name: string,
  value: string | undefined,
): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new Error(`${name} must be true, false, 1, or 0`);
}

export function readSeedProductPhotoOptions(
  env: NodeJS.ProcessEnv = process.env,
): SeedProductPhotoOptions {
  return {
    enabled:
      parseOptionalBoolean('SEED_PRODUCT_PHOTOS', env.SEED_PRODUCT_PHOTOS) ??
      true,
    required:
      parseOptionalBoolean(
        'SEED_PRODUCT_PHOTOS_REQUIRED',
        env.SEED_PRODUCT_PHOTOS_REQUIRED,
      ) ?? false,
  };
}

export function hasProductPhotoStorageEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return PRODUCT_PHOTO_STORAGE_ENV_KEYS.every((key) =>
    Boolean(env[key]?.trim()),
  );
}

export function seededProductPhotoPrefix(tenantId: string): string {
  return `seed/product-photos/${tenantId}/`;
}

export function seededProductPhotoObjectKey(
  tenantId: string,
  productId: string,
  index = 0,
): string {
  return `${seededProductPhotoPrefix(tenantId)}${productId}/photo-${index}.png`;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);

  return Buffer.concat([length, typeBytes, data, checksum]);
}

function colorRamp(seed: string): {
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly accent: readonly [number, number, number];
} {
  const hash = crypto.createHash('sha256').update(seed).digest();
  return {
    from: [hash[0]!, hash[1]!, hash[2]!],
    to: [hash[8]!, hash[9]!, hash[10]!],
    accent: [hash[16]!, hash[17]!, hash[18]!],
  };
}

export function createSeedProductPng(
  seed: string,
  width = 320,
  height = 240,
): Buffer {
  const { from, to, accent } = colorRamp(seed);
  const rows: Buffer[] = [];

  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;

    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 4;
      const horizontal = x / Math.max(width - 1, 1);
      const vertical = y / Math.max(height - 1, 1);
      const stripe = Math.sin((x + y) / 18) > 0.45 ? 0.18 : 0;
      const accentWeight = x > width * 0.68 && y < height * 0.32 ? 0.28 : 0;
      const blend = Math.min(1, horizontal * 0.7 + vertical * 0.3 + stripe);

      row[offset] = Math.round(
        from[0] * (1 - blend) +
          to[0] * blend * (1 - accentWeight) +
          accent[0] * accentWeight,
      );
      row[offset + 1] = Math.round(
        from[1] * (1 - blend) +
          to[1] * blend * (1 - accentWeight) +
          accent[1] * accentWeight,
      );
      row[offset + 2] = Math.round(
        from[2] * (1 - blend) +
          to[2] * blend * (1 - accentWeight) +
          accent[2] * accentWeight,
      );
      row[offset + 3] = 255;
    }

    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function seedProductPhotoFilename(
  product: typeof products.$inferSelect,
): string {
  return `${product.sku.toLowerCase()}-seed.png`;
}
