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

// Stable per (event identity, recipient, channel, day) so a recurring scan does
// not re-alert the same condition to the same person on the same channel within
// the window — while still letting two different users (or an email + an SMS to
// one user) each get their own ledger row under the partial unique index.
// Transactional events are never deduped.
export const buildDedupeKey = (
  event: NotificationEvent,
  recipientUserId: string,
  channel: NotificationChannel,
  day: string,
): string | null => {
  switch (event.kind) {
    case 'low-stock':
      return `low-stock:${event.productId}:${event.locationId}:${recipientUserId}:${channel}:${day}`;
    default:
      return null;
  }
};

// D6 default policy: every alert category defaults to email-on / SMS-off, and
// absence of a stored preference row falls back to these.
export const CHANNEL_DEFAULTS: Record<
  NotificationCategory,
  Record<NotificationChannel, boolean>
> = {
  [NotificationCategory.ACCOUNT]: {
    [NotificationChannel.EMAIL]: true,
    [NotificationChannel.SMS]: false,
  },
  [NotificationCategory.INVENTORY_ALERTS]: {
    [NotificationChannel.EMAIL]: true,
    [NotificationChannel.SMS]: false,
  },
  [NotificationCategory.ORDER_LIFECYCLE]: {
    [NotificationChannel.EMAIL]: true,
    [NotificationChannel.SMS]: false,
  },
};

// D6: account/transactional delivery is mandatory and ignores stored prefs, so
// a user can never disable the email that lets them back into their account.
export const PREFERENCE_BYPASS_CATEGORIES: ReadonlySet<NotificationCategory> =
  new Set([NotificationCategory.ACCOUNT]);

export const channelDefault = (
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean => CHANNEL_DEFAULTS[category][channel];

// Resolve whether a (category, channel) is enabled for a user, given their
// stored preference (`undefined` when they've never set one for this pair).
export const effectivePref = (
  category: NotificationCategory,
  channel: NotificationChannel,
  storedEnabled: boolean | undefined,
): boolean => {
  const fallback = channelDefault(category, channel);
  // Mandatory categories ignore stored prefs entirely (no self-lockout).
  if (PREFERENCE_BYPASS_CATEGORIES.has(category)) {
    return fallback;
  }
  // `??` (not `||`) so an explicit stored `false` is respected and only a
  // genuinely-absent (`undefined`) preference falls back to the default.
  return storedEnabled ?? fallback;
};
