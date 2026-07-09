import { describe, expect, it } from 'vitest';
import { NotificationCategory } from '@stocket/types/notifications';
import { DEFAULT_LOCALE } from '../../platform/observability/messages';
import {
  buildScanContext,
  buildDedupeKey,
  describeError,
  effectivePref,
  eventCategory,
  shouldSendEmail,
  toEmailTemplate,
  toNotificationDay,
  toSupportedLocale,
} from './notifications.utils';
import type { NotificationEvent } from './types';

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

describe('eventCategory', () => {
  it('maps low-stock to the inventory_alerts category', () => {
    expect(eventCategory('low-stock')).toBe(
      NotificationCategory.INVENTORY_ALERTS,
    );
  });
});

describe('buildDedupeKey', () => {
  it('is stable per product/location/recipient/day for low-stock', () => {
    expect(buildDedupeKey(lowStock, 'u1', '2026-06-14')).toBe(
      'low-stock:p1:l1:u1:email:2026-06-14',
    );
  });

  it('changes with the day so a later window re-alerts', () => {
    expect(buildDedupeKey(lowStock, 'u1', '2026-06-14')).not.toBe(
      buildDedupeKey(lowStock, 'u1', '2026-06-15'),
    );
  });

  it('differs per recipient so each gets its own ledger row', () => {
    expect(buildDedupeKey(lowStock, 'u1', '2026-06-14')).not.toBe(
      buildDedupeKey(lowStock, 'u2', '2026-06-14'),
    );
  });
});

describe('notification service helpers', () => {
  it('formats UTC notification day stamps from explicit dates', () => {
    expect(toNotificationDay(new Date('2026-06-14T23:59:59.000Z'))).toBe(
      '2026-06-14',
    );
  });

  it('normalizes supported locales and falls back to the platform default', () => {
    expect(toSupportedLocale('fr')).toBe('fr');
    expect(toSupportedLocale('de')).toBe('de');
    expect(toSupportedLocale('es')).toBe(DEFAULT_LOCALE);
    expect(toSupportedLocale(null)).toBe(DEFAULT_LOCALE);
  });

  it('describes thrown and object-shaped errors without dropping message text', () => {
    expect(describeError(new Error('provider failed'))).toBe('provider failed');
    expect(describeError({ message: 'ledger failed' })).toBe('ledger failed');
    expect(describeError(404)).toBe('404');
  });

  it('maps low-stock events to email templates', () => {
    expect(toEmailTemplate(lowStock)).toEqual({
      kind: 'low-stock',
      sku: 'SKU-1',
      productName: 'Widget',
      locationName: 'Main Warehouse',
      quantity: 2,
      reorderPoint: 10,
    });
  });

  it('builds synthetic scan request contexts from explicit ids', () => {
    expect(buildScanContext('tenant-1', 'request-1')).toEqual({
      requestId: 'request-1',
      path: '/scheduled/low-stock-scan',
      method: 'GET',
      ip: null,
      locale: DEFAULT_LOCALE,
      tenantId: 'tenant-1',
    });
  });
});

describe('effectivePref (D6 default policy)', () => {
  const { ACCOUNT, INVENTORY_ALERTS } = NotificationCategory;

  it('account email is always on and ignores a stored opt-out (no self-lockout)', () => {
    expect(effectivePref(ACCOUNT, undefined)).toBe(true);
    expect(effectivePref(ACCOUNT, false)).toBe(true);
    expect(effectivePref(ACCOUNT, true)).toBe(true);
  });

  it('alert email defaults on (opt-out) and respects an explicit false', () => {
    expect(effectivePref(INVENTORY_ALERTS, undefined)).toBe(true);
    expect(effectivePref(INVENTORY_ALERTS, false)).toBe(false);
    expect(effectivePref(INVENTORY_ALERTS, true)).toBe(true);
  });
});

describe('shouldSendEmail', () => {
  it('uses the effective email preference policy for nullable stored values', () => {
    expect(shouldSendEmail(NotificationCategory.INVENTORY_ALERTS, null)).toBe(
      true,
    );
    expect(shouldSendEmail(NotificationCategory.INVENTORY_ALERTS, false)).toBe(
      false,
    );
    expect(shouldSendEmail(NotificationCategory.INVENTORY_ALERTS, true)).toBe(
      true,
    );
  });
});
