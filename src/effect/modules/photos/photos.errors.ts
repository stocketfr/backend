import {
  NotFoundError,
  BadRequestError,
  InternalError,
} from '../../platform/effect/domain-errors';

export class InvalidPhotoMimeType extends BadRequestError(
  'InvalidPhotoMimeType',
)<{
  readonly mimetype: string;
}> {}

export class PhotoTooLarge extends BadRequestError('PhotoTooLarge')<{
  readonly size: number;
  readonly maxSize: number;
}> {}

export class PhotoNotFound extends NotFoundError('PhotoNotFound')<{
  readonly id: string;
}> {}

export class PhotoFileNotFound extends NotFoundError('PhotoFileNotFound')<{
  readonly id: string;
  readonly path: string;
}> {}

export class PhotosInfrastructureError extends InternalError(
  'PhotosInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
