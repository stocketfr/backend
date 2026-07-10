import { describe, expect, it } from '@effect/vitest';
import { beforeEach, vi } from 'vitest';
import { Effect } from 'effect';
import {
  NotificationCategory,
  NotificationChannel,
} from '@stocket/types/notifications';
import {
  makeMockServiceLayer,
  makeServiceTestHarness,
} from '../../testing/test-harness';
import {
  NotificationsRepository,
  type AudienceCandidate,
  type LowStockItem,
  type RecordPendingParams,
} from './repository';
import { NotificationsService } from './service';
import type { NotificationEvent, Recipient } from './types';

// defaultMailer is a module singleton; mock it so we control send outcomes and
// can assert delivery without hitting a real transport.
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));
vi.mock('../../../email/default-mailer', () => ({
  defaultMailer: { send: mockSend },
}));

const recipient: Recipient = {
  userId: 'u1',
  email: 'u1@test',
  locale: 'en',
};

const lowStockEvent: NotificationEvent = {
  kind: 'low-stock',
  productId: 'p1',
  locationId: 'l1',
  sku: 'SKU1',
  productName: 'Widget',
  locationName: 'Main Warehouse',
  quantity: 2,
  reorderPoint: 10,
};

const lowStockItem: LowStockItem = {
  productId: 'p1',
  locationId: 'l1',
  sku: 'SKU1',
  productName: 'Widget',
  locationName: 'Main Warehouse',
  quantity: 2,
  reorderPoint: 10,
};

const candidate = (over: Partial<AudienceCandidate>): AudienceCandidate => ({
  userId: 'u1',
  email: 'u1@test',
  locale: 'en',
  emailEnabled: null,
  ...over,
});

const makeDefaultRepo = () =>
  ({
    recordPending: vi.fn((_p: RecordPendingParams) =>
      Effect.succeed<string | null>('notif-1'),
    ),
    markSent: vi.fn(() => Effect.void),
    markFailed: vi.fn(() => Effect.void),
    findLowStock: vi.fn(() => Effect.succeed([lowStockItem])),
    listTenantIds: vi.fn(() => Effect.succeed(['t1'])),
    findAudience: vi.fn(() => Effect.succeed([candidate({})])),
  }) satisfies Partial<NotificationsRepository>;

const makeRepo = makeMockServiceLayer(NotificationsRepository, makeDefaultRepo);

const serviceHarness = makeServiceTestHarness(
  NotificationsService,
  NotificationsService.DefaultWithoutDependencies,
);

describe('NotificationsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
  });

  describe('notify', () => {
    it.effect('records, sends, and marks the ledger row sent', () => {
      mockSend.mockResolvedValue({ id: 'provider-1' });
      const repo = makeRepo();
      return serviceHarness.effect(repo.layer, (svc) =>
        Effect.gen(function* () {
          yield* svc.notify(recipient, lowStockEvent);
          expect(repo.service.recordPending).toHaveBeenCalledTimes(1);
          expect(mockSend).toHaveBeenCalledTimes(1);
          expect(repo.service.markSent).toHaveBeenCalledWith(
            'notif-1',
            'provider-1',
          );
          expect(repo.service.markFailed).not.toHaveBeenCalled();
        }),
      );
    });

    it.effect('skips delivery when the dedupe key is already claimed', () => {
      const repo = makeRepo({
        recordPending: vi.fn((_p: RecordPendingParams) =>
          Effect.succeed<string | null>(null),
        ),
      });
      return serviceHarness.effect(repo.layer, (svc) =>
        Effect.gen(function* () {
          yield* svc.notify(recipient, lowStockEvent);
          expect(repo.service.recordPending).toHaveBeenCalledTimes(1);
          expect(mockSend).not.toHaveBeenCalled();
          expect(repo.service.markSent).not.toHaveBeenCalled();
        }),
      );
    });

    // Live clock: the retry backoff uses real delays that a TestClock would
    // freeze, so this case runs under it.live.
    it.live('marks failed after the provider keeps failing', () => {
      mockSend.mockRejectedValue(new Error('smtp down'));
      const repo = makeRepo();
      return serviceHarness.effect(repo.layer, (svc) =>
        Effect.gen(function* () {
          yield* svc.notify(recipient, lowStockEvent);
          // 1 initial attempt + 3 bounded retries
          expect(mockSend).toHaveBeenCalledTimes(4);
          expect(repo.service.markFailed).toHaveBeenCalledTimes(1);
          expect(repo.service.markSent).not.toHaveBeenCalled();
        }),
      );
    });
  });

  describe('runScan', () => {
    it.effect(
      'alerts opted-in staff, skipping opt-outs and missing emails',
      () => {
        mockSend.mockResolvedValue({ id: 'provider-1' });
        const repo = makeRepo({
          findAudience: vi.fn(() =>
            Effect.succeed([
              candidate({ userId: 'in', email: 'in@test', emailEnabled: null }),
              candidate({
                userId: 'out',
                email: 'out@test',
                emailEnabled: false,
              }),
              candidate({ userId: 'noemail', email: null, emailEnabled: null }),
            ]),
          ),
        });
        return serviceHarness.effect(repo.layer, (svc) =>
          Effect.gen(function* () {
            yield* svc.runScan;
            // 1 low-stock item × 1 eligible recipient ('in')
            expect(repo.service.recordPending).toHaveBeenCalledTimes(1);
            const arg = repo.service.recordPending.mock.calls[0]![0];
            expect(arg.userId).toBe('in');
            expect(arg.category).toBe(NotificationCategory.INVENTORY_ALERTS);
            expect(arg.channel).toBe(NotificationChannel.EMAIL);
          }),
        );
      },
    );

    it.effect('does nothing when there are no low-stock items', () => {
      const repo = makeRepo({ findLowStock: vi.fn(() => Effect.succeed([])) });
      return serviceHarness.effect(repo.layer, (svc) =>
        Effect.gen(function* () {
          yield* svc.runScan;
          expect(repo.service.findAudience).not.toHaveBeenCalled();
          expect(repo.service.recordPending).not.toHaveBeenCalled();
        }),
      );
    });
  });
});
