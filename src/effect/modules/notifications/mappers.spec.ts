import { describe, expect, it } from '@effect/vitest';
import {
  NotificationCategory,
  NotificationChannel,
} from '@stocket/types/notifications';
import { toNotificationPreferencesResponse } from './mappers';

describe('notification mappers', () => {
  it('maps stored preferences to the API response shape', () => {
    expect(
      toNotificationPreferencesResponse([
        {
          category: NotificationCategory.INVENTORY_ALERTS,
          channel: NotificationChannel.EMAIL,
          enabled: false,
        },
      ]),
    ).toEqual({
      preferences: [
        {
          category: NotificationCategory.INVENTORY_ALERTS,
          channel: NotificationChannel.EMAIL,
          enabled: false,
        },
      ],
    });
  });
});
