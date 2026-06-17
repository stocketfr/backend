import { describe, expect, it } from 'vitest';
import { NotificationCategory } from '@stocket/types/notifications';
import {
  buildDedupeKey,
  effectivePref,
  eventCategory,
} from './notifications.utils';
import type { NotificationEvent } from './types';

describe('eventCategory', () => {
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
