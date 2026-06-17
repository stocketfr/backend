import {
  NotificationCategory,
  NotificationChannel,
} from '@stocket/types/notifications';
import {
  EVENT_CATEGORY,
  type NotificationEvent,
  type NotificationEventKind,
} from './types';

export const eventCategory = (
  kind: NotificationEventKind,
): NotificationCategory => EVENT_CATEGORY[kind];

// Stable per (event identity, recipient, day) so a recurring scan does not
// re-alert the same condition to the same person within the window.
export const buildDedupeKey = (
  event: NotificationEvent,
  recipientUserId: string,
  day: string,
): string =>
  `low-stock:${event.productId}:${event.locationId}:${recipientUserId}:${NotificationChannel.EMAIL}:${day}`;

const EMAIL_DEFAULTS: Record<NotificationCategory, boolean> = {
  [NotificationCategory.ACCOUNT]: true,
  [NotificationCategory.INVENTORY_ALERTS]: true,
  [NotificationCategory.ORDER_LIFECYCLE]: true,
};

// Account delivery is mandatory and ignores stored prefs, so a user can never
// disable the email that lets them back into their account.
const PREFERENCE_BYPASS_CATEGORIES: ReadonlySet<NotificationCategory> =
  new Set([NotificationCategory.ACCOUNT]);

// Resolve whether email is enabled for a user, given their stored preference
// (`undefined` when they've never set one for this category).
export const effectivePref = (
  category: NotificationCategory,
  storedEnabled: boolean | undefined,
): boolean => {
  const fallback = EMAIL_DEFAULTS[category];
  // Mandatory categories ignore stored prefs entirely (no self-lockout).
  if (PREFERENCE_BYPASS_CATEGORIES.has(category)) {
    return fallback;
  }
  // `??` (not `||`) so an explicit stored `false` is respected and only a
  // genuinely-absent (`undefined`) preference falls back to the default.
  return storedEnabled ?? fallback;
};
