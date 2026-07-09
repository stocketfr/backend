import { Schema } from 'effect';
import {
  NotificationPreferenceUpdateSchema,
  type NotificationPreferencesResponseDto,
} from '@stocket/types/notifications';
import type { StoredPreferenceRow } from './types';

const decodeStoredPreference = Schema.decodeUnknownSync(
  NotificationPreferenceUpdateSchema,
);

export const toNotificationPreferencesResponse = (
  rows: readonly StoredPreferenceRow[],
): NotificationPreferencesResponseDto => ({
  preferences: rows.map((row) => decodeStoredPreference(row)),
});
