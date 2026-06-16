import { NotificationCategory } from '@stocket/types/notifications';
import type { SupportedLocale } from '../../platform/observability/messages';

// Channel-agnostic facts the Notifier can deliver. The auth events mirror
// @stocket/emails' ActionEmail inputs; alert events carry their own identity
// (productId/locationId) so scheduled scans can build a stable dedupe key.
export type NotificationEvent =
  | {
      readonly kind: 'verify-email';
      readonly userName: string;
      readonly actionUrl: string;
    }
  | {
      readonly kind: 'reset-password';
      readonly userName: string;
      readonly actionUrl: string;
    }
  | {
      readonly kind: 'welcome-set-password';
      readonly userName: string;
      readonly actionUrl: string;
    }
  | {
      readonly kind: 'low-stock';
      readonly productId: string;
      readonly locationId: string;
      readonly sku: string;
      readonly productName: string;
      readonly locationName: string;
      readonly quantity: number;
      readonly reorderPoint: number;
    };

export type NotificationEventKind = NotificationEvent['kind'];

// Lifecycle of a single ledger row (D8).
export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

// A resolved target for a single notification. phone/locale come from the
// persisted user record (D7) — scheduled sends have no request to read.
export interface Recipient {
  readonly userId: string;
  readonly email: string;
  readonly phone: string | null;
  readonly locale: SupportedLocale;
}

// Each event maps to exactly one preference category (D5).
export const EVENT_CATEGORY: Record<NotificationEventKind, NotificationCategory> =
  {
    'verify-email': NotificationCategory.ACCOUNT,
    'reset-password': NotificationCategory.ACCOUNT,
    'welcome-set-password': NotificationCategory.ACCOUNT,
    'low-stock': NotificationCategory.INVENTORY_ALERTS,
  };
