import {
  NotificationCategory,
  NotificationChannel,
} from '@stocket/types/notifications';
import type { EmailTemplate } from '@stocket/emails';
import {
  DEFAULT_LOCALE,
  type SupportedLocale,
} from '../../platform/observability/messages';
import type { RequestContext } from '../../platform/http/request-context';
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

export const toNotificationDay = (date: Date): string =>
  date.toISOString().slice(0, 10);

export const toSupportedLocale = (value: string | null): SupportedLocale =>
  value === 'en' || value === 'fr' || value === 'de' ? value : DEFAULT_LOCALE;

export const describeError = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  if (
    error !== null &&
    typeof error === 'object' &&
    !Array.isArray(error) &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim() !== ''
  ) {
    return error.message;
  }

  return String(error);
};

export const toEmailTemplate = (
  event: NotificationEvent,
): EmailTemplate => ({
  kind: 'low-stock',
  sku: event.sku,
  productName: event.productName,
  locationName: event.locationName,
  quantity: event.quantity,
  reorderPoint: event.reorderPoint,
});

export const buildScanContext = (
  tenantId: string,
  requestId: string,
): RequestContext => ({
  requestId,
  path: '/scheduled/low-stock-scan',
  method: 'GET',
  ip: null,
  locale: DEFAULT_LOCALE,
  tenantId,
});

const EMAIL_DEFAULTS: Record<NotificationCategory, boolean> = {
  [NotificationCategory.ACCOUNT]: true,
  [NotificationCategory.INVENTORY_ALERTS]: true,
  [NotificationCategory.ORDER_LIFECYCLE]: true,
};

// Account delivery is mandatory and ignores stored prefs, so a user can never
// disable the email that lets them back into their account.
const PREFERENCE_BYPASS_CATEGORIES: ReadonlySet<NotificationCategory> = new Set(
  [NotificationCategory.ACCOUNT],
);

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

export const shouldSendEmail = (
  category: NotificationCategory,
  storedEnabled: boolean | null | undefined,
): boolean => effectivePref(category, storedEnabled ?? undefined);
