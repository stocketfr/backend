import type { Buffer } from 'node:buffer';
import type { photos } from '../../platform/db/schema';

export type PhotoEntity = typeof photos.$inferSelect;

export const ALLOWED_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type PhotoMimeType = (typeof ALLOWED_PHOTO_MIME_TYPES)[number];

export const MAX_PHOTO_FILE_SIZE = 10 * 1024 * 1024;

export const PHOTO_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export interface PhotoMagicSignature {
  readonly bytes: readonly number[];
  readonly offset: number;
}

export const PHOTO_MAGIC_SIGNATURES: Readonly<
  Record<string, readonly PhotoMagicSignature[]>
> = {
  'image/jpeg': [{ bytes: [0xff, 0xd8, 0xff], offset: 0 }],
  'image/png': [{ bytes: [0x89, 0x50, 0x4e, 0x47], offset: 0 }],
  'image/gif': [{ bytes: [0x47, 0x49, 0x46, 0x38], offset: 0 }],
  'image/webp': [
    { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
    { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  ],
};

export interface UploadedFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

export interface PhotoFileResult {
  readonly bytes: Uint8Array;
  readonly mimetype: string;
  readonly filename: string;
}

export interface PhotoCreateValues {
  readonly product_id: string;
  readonly filename: string;
  readonly mimetype: string;
  readonly size: number;
  readonly storage_path: string;
  readonly display_order: number;
  readonly uploaded_by: string | null;
}

export interface PhotoCreateValuesOptions {
  readonly productId: string;
  readonly file: UploadedFile;
  readonly objectKey: string;
  readonly displayOrder: number;
  readonly userId?: string;
}
