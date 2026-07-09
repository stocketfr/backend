import { describe, expect, it } from '@effect/vitest';
import { StorageError } from '../../platform/storage';
import {
  mapPhotoStorageDeleteError,
  mapPhotoStorageReadError,
  mapPhotoStorageWriteError,
} from './storage-errors';

describe('photo storage error mappers', () => {
  it('maps storage actions to photo infrastructure message keys', () => {
    const cause = new StorageError({ action: 'putObject', key: 'photo.jpg' });

    expect(mapPhotoStorageWriteError(cause)).toMatchObject({
      _tag: 'PhotosInfrastructureError',
      action: 'write photo object',
      messageKey: 'photos.writeFailed',
      cause,
    });
    expect(mapPhotoStorageReadError(cause)).toMatchObject({
      action: 'read photo object',
      messageKey: 'photos.readFailed',
      cause,
    });
    expect(mapPhotoStorageDeleteError(cause)).toMatchObject({
      action: 'delete photo object',
      messageKey: 'photos.deleteFailed',
      cause,
    });
  });
});
