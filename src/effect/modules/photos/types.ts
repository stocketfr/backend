export interface UploadedFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

export interface PhotoUploadOptions {
  readonly sourceUrl?: string | null;
}
