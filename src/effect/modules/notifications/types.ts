import type { EmailTemplate } from '@stocket/emails';
import { NotificationCategory } from '@stocket/types/notifications';
import type { SupportedLocale } from '../../platform/observability/messages';

type LowStockTemplate = Extract<EmailTemplate, { readonly kind: 'low-stock' }>;

// Low-stock email payload plus stable identity for the dedupe ledger.
export type NotificationEvent = LowStockTemplate & {
  readonly productId: string;
  readonly locationId: string;
};

export type NotificationEventKind = NotificationEvent['kind'];

// Lifecycle of a single ledger row (D8).
export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

// A resolved target for a single notification. locale comes from the persisted
// user record because scheduled sends have no request to read.
export interface Recipient {
  readonly userId: string;
  readonly email: string;
  readonly locale: SupportedLocale;
}

// Each event maps to exactly one preference category (D5).
export const EVENT_CATEGORY: Record<
  NotificationEventKind,
  NotificationCategory
> = {
  'low-stock': NotificationCategory.INVENTORY_ALERTS,
};
