import { describe, expect, it } from '@effect/vitest';
import { vi } from 'vitest';
import { Effect } from 'effect';
import {
  NotificationCategory,
  NotificationChannel,
} from '@stocket/types/notifications';
import {
  makeNotificationDeliveryWorkflows,
  type NotificationDeliveryRepository,
} from './delivery';
import type { NotificationEvent, Recipient } from './types';
import type { RecordPendingParams } from './repository';

const recipient: Recipient = {
  userId: 'user-1',
  email: 'user@example.test',
  locale: 'en',
};

const event: NotificationEvent = {
  kind: 'low-stock',
  productId: 'product-1',
  locationId: 'location-1',
  sku: 'SKU-1',
  productName: 'Orange Juice',
  locationName: 'Warehouse A',
  quantity: 2,
  reorderPoint: 10,
};

const makeRepository = (
  overrides: Partial<NotificationDeliveryRepository> = {},
): NotificationDeliveryRepository => ({
  recordPending: () => Effect.succeed('notification-1'),
  markSent: () => Effect.void,
  markFailed: () => Effect.void,
  ...overrides,
});

describe('notification delivery workflows', () => {
  it.effect('records a pending row, sends email, and marks the row sent', () =>
    Effect.gen(function* () {
      let pendingParams: RecordPendingParams | undefined;
      let sent:
        | {
            readonly id: string;
            readonly providerMessageId: string | null;
          }
        | undefined;
      const sendEmail = vi.fn().mockResolvedValue({ id: 'provider-1' });
      const workflows = makeNotificationDeliveryWorkflows({
        repository: makeRepository({
          recordPending: (params) =>
            Effect.sync(() => {
              pendingParams = params;
              return 'notification-1';
            }),
          markSent: (id, providerMessageId) =>
            Effect.sync(() => {
              sent = { id, providerMessageId };
            }),
        }),
        sendEmail,
        now: () => new Date('2026-03-01T12:00:00.000Z'),
      });

      yield* workflows.notify(recipient, event);

      expect(pendingParams).toEqual({
        userId: 'user-1',
        eventKind: 'low-stock',
        category: NotificationCategory.INVENTORY_ALERTS,
        channel: NotificationChannel.EMAIL,
        dedupeKey: 'low-stock:product-1:location-1:user-1:email:2026-03-01',
      });
      expect(sendEmail).toHaveBeenCalledWith({
        to: 'user@example.test',
        locale: 'en',
        template: {
          kind: 'low-stock',
          sku: 'SKU-1',
          productName: 'Orange Juice',
          locationName: 'Warehouse A',
          quantity: 2,
          reorderPoint: 10,
        },
      });
      expect(sent).toEqual({
        id: 'notification-1',
        providerMessageId: 'provider-1',
      });
    }),
  );

  it.effect('skips sending when the dedupe key is already claimed', () =>
    Effect.gen(function* () {
      let markSentCalled = false;
      const sendEmail = vi.fn().mockResolvedValue({ id: 'provider-1' });
      const workflows = makeNotificationDeliveryWorkflows({
        repository: makeRepository({
          recordPending: () => Effect.succeed(null),
          markSent: () =>
            Effect.sync(() => {
              markSentCalled = true;
            }),
        }),
        sendEmail,
        now: () => new Date('2026-03-01T12:00:00.000Z'),
      });

      yield* workflows.notify(recipient, event);

      expect(sendEmail).not.toHaveBeenCalled();
      expect(markSentCalled).toBe(false);
    }),
  );

  it.live('marks failed after provider retries are exhausted', () => {
    const sendEmail = vi.fn().mockRejectedValue(new Error('smtp down'));
    let failed:
      | {
          readonly id: string;
          readonly error: string;
        }
      | undefined;
    const workflows = makeNotificationDeliveryWorkflows({
      repository: makeRepository({
        markFailed: (id, error) =>
          Effect.sync(() => {
            failed = { id, error };
          }),
      }),
      sendEmail,
      now: () => new Date('2026-03-01T12:00:00.000Z'),
    });

    return Effect.gen(function* () {
      yield* workflows.notify(recipient, event);

      expect(sendEmail).toHaveBeenCalledTimes(4);
      expect(failed).toEqual({
        id: 'notification-1',
        error: 'smtp down',
      });
    });
  });
});
