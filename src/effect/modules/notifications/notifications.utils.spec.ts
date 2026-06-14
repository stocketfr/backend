import { describe, expect, it } from 'vitest';
import {
  NotificationCategory,
  NotificationChannel,
} from '@stocket/types/notifications';
import {
  buildDedupeKey,
  channelDefault,
  effectivePref,
  eventCategory,
} from './notifications.utils';
import type { NotificationEvent } from './types';

describe('eventCategory', () => {
  it('maps auth events to the account category', () => {
    expect(eventCategory('verify-email')).toBe(NotificationCategory.ACCOUNT);
    expect(eventCategory('reset-password')).toBe(NotificationCategory.ACCOUNT);
    expect(eventCategory('welcome-set-password')).toBe(
      NotificationCategory.ACCOUNT,
    );
  });

  it('maps low-stock to the inventory_alerts category', () => {
    expect(eventCategory('low-stock')).toBe(
      NotificationCategory.INVENTORY_ALERTS,
    );
  });
});

describe('buildDedupeKey', () => {
  const lowStock: NotificationEvent = {
    kind: 'low-stock',
    productId: 'p1',
    locationId: 'l1',
    sku: 'SKU-1',
    productName: 'Widget',
    locationName: 'Main Warehouse',
    quantity: 2,
    reorderPoint: 10,
  };

  const { EMAIL, SMS } = NotificationChannel;

  it('is stable per product/location/recipient/channel/day for low-stock', () => {
    expect(buildDedupeKey(lowStock, 'u1', EMAIL, '2026-06-14')).toBe(
      'low-stock:p1:l1:u1:email:2026-06-14',
    );
  });

  it('changes with the day so a later window re-alerts', () => {
    expect(buildDedupeKey(lowStock, 'u1', EMAIL, '2026-06-14')).not.toBe(
      buildDedupeKey(lowStock, 'u1', EMAIL, '2026-06-15'),
    );
  });

  it('differs per recipient and per channel so each gets its own ledger row', () => {
    expect(buildDedupeKey(lowStock, 'u1', EMAIL, '2026-06-14')).not.toBe(
      buildDedupeKey(lowStock, 'u2', EMAIL, '2026-06-14'),
    );
    expect(buildDedupeKey(lowStock, 'u1', EMAIL, '2026-06-14')).not.toBe(
      buildDedupeKey(lowStock, 'u1', SMS, '2026-06-14'),
    );
  });

  it('returns null for transactional events (never deduped)', () => {
    const verify: NotificationEvent = {
      kind: 'verify-email',
      userName: 'Jeanne',
      actionUrl: 'https://app.test/verify',
    };
    expect(buildDedupeKey(verify, 'u1', EMAIL, '2026-06-14')).toBeNull();
  });
});

describe('effectivePref (D6 default policy)', () => {
  const { ACCOUNT, INVENTORY_ALERTS } = NotificationCategory;
  const { EMAIL, SMS } = NotificationChannel;

  it('account email is always on and ignores a stored opt-out (no self-lockout)', () => {
    expect(effectivePref(ACCOUNT, EMAIL, undefined)).toBe(true);
    expect(effectivePref(ACCOUNT, EMAIL, false)).toBe(true);
    expect(effectivePref(ACCOUNT, EMAIL, true)).toBe(true);
  });

  it('account sms stays off even if a stored row tried to enable it', () => {
    expect(effectivePref(ACCOUNT, SMS, true)).toBe(false);
    expect(effectivePref(ACCOUNT, SMS, undefined)).toBe(false);
  });

  it('alert email defaults on (opt-out) and respects an explicit false', () => {
    expect(effectivePref(INVENTORY_ALERTS, EMAIL, undefined)).toBe(true);
    expect(effectivePref(INVENTORY_ALERTS, EMAIL, false)).toBe(false);
    expect(effectivePref(INVENTORY_ALERTS, EMAIL, true)).toBe(true);
  });

  it('alert sms defaults off (opt-in) and respects an explicit true', () => {
    expect(effectivePref(INVENTORY_ALERTS, SMS, undefined)).toBe(false);
    expect(effectivePref(INVENTORY_ALERTS, SMS, true)).toBe(true);
    expect(effectivePref(INVENTORY_ALERTS, SMS, false)).toBe(false);
  });
});

describe('channelDefault', () => {
  it('encodes email-on / sms-off across every category', () => {
    for (const category of Object.values(NotificationCategory)) {
      expect(channelDefault(category, NotificationChannel.EMAIL)).toBe(true);
      expect(channelDefault(category, NotificationChannel.SMS)).toBe(false);
    }
  });
});
