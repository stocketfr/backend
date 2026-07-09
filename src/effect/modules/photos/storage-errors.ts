import type { StorageError } from '../../platform/storage';
import { PhotosInfrastructureError } from './photos.errors';

export const mapPhotoStorageWriteError = (cause: StorageError) =>
  new PhotosInfrastructureError({
    action: 'write photo object',
    cause,
    messageKey: 'photos.writeFailed',
  });

export const mapPhotoStorageReadError = (cause: StorageError) =>
  new PhotosInfrastructureError({
    action: 'read photo object',
    cause,
    messageKey: 'photos.readFailed',
  });

export const mapPhotoStorageDeleteError = (cause: StorageError) =>
  new PhotosInfrastructureError({
    action: 'delete photo object',
    cause,
    messageKey: 'photos.deleteFailed',
  });
