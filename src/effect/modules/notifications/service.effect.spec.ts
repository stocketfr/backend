import { describe, expect, it } from '@effect/vitest';
import { beforeEach, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import {
  NotificationCategory,
  NotificationChannel,
} from '@stocket/types/notifications';
import { makeTestLayer } from '../../testing/utils';
import {
  NotificationsRepository,
  type AudienceCandidate,
  type LowStockItem,
  type RecordPendingParams,
} from './repository';
import { NotificationsService } from './service';
import type { NotificationEvent, Recipient } from './types';

// defaultMailer / defaultTexter are module singletons; mock them so we control
// send outcomes and can assert delivery without hitting a real transport.
const { mockSend, mockTexterSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockTexterSend: vi.fn(),
}));
vi.mock('../../../email/default-mailer', () => ({
  defaultMailer: { transportName: 'mock', send: mockSend },
}));
vi.mock('../../../sms/default-texter', () => ({
  defaultTexter: { transportName: 'mock-sms', send: mockTexterSend },
}));

const { EMAIL, SMS } = NotificationChannel;

const recipient: Recipient = {
  userId: 'u1',
  email: 'u1@test',
  phone: null,
  locale: 'en',
};

const smsRecipient: Recipient = { ...recipient, phone: '+15551234567' };

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
  phone: null,
  locale: 'en',
  emailEnabled: null,
  smsEnabled: null,
  ...over,
});

const makeRepo = (overrides: Record<string, unknown> = {}) => {
  const mocks = {
    recordPending: vi.fn((_p: RecordPendingParams) =>
      Effect.succeed<string | null>('notif-1'),
    ),
    markSent: vi.fn(() => Effect.void),
    markFailed: vi.fn(() => Effect.void),
    findLowStock: vi.fn(() => Effect.succeed([lowStockItem])),
    listTenantIds: vi.fn(() => Effect.succeed(['t1'])),
    findAudience: vi.fn(() => Effect.succeed([candidate({})])),
    ...overrides,
  };
  return {
    mocks,
    layer: makeTestLayer(NotificationsRepository)(
      mocks as unknown as Partial<NotificationsRepository>,
    ),
  };
};

const run = <A, E>(
  repoLayer: Layer.Layer<NotificationsRepository>,
  body: (svc: NotificationsService) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const svc = yield* NotificationsService;
    return yield* body(svc);
  }).pipe(
    Effect.provide(
      NotificationsService.DefaultWithoutDependencies.pipe(
        Layer.provide(repoLayer),
      ),
    ),
  );

describe('NotificationsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
    mockTexterSend.mockReset();
  });

  describe('notify', () => {
    it.effect('records, sends, and marks the ledger row sent', () => {
      mockSend.mockResolvedValue({ id: 'provider-1' });
      const repo = makeRepo();
      return run(repo.layer, (svc) =>
        Effect.gen(function* () {
          yield* svc.notify(recipient, lowStockEvent, [EMAIL]);
          expect(repo.mocks.recordPending).toHaveBeenCalledTimes(1);
          expect(mockSend).toHaveBeenCalledTimes(1);
          expect(repo.mocks.markSent).toHaveBeenCalledWith(
            'notif-1',
            'provider-1',
          );
          expect(repo.mocks.markFailed).not.toHaveBeenCalled();
        }),
      );
    });

    it.effect('skips delivery when the dedupe key is already claimed', () => {
      const repo = makeRepo({
        recordPending: vi.fn((_p: RecordPendingParams) =>
          Effect.succeed<string | null>(null),
        ),
      });
      return run(repo.layer, (svc) =>
        Effect.gen(function* () {
          yield* svc.notify(recipient, lowStockEvent, [EMAIL]);
          expect(repo.mocks.recordPending).toHaveBeenCalledTimes(1);
          expect(mockSend).not.toHaveBeenCalled();
          expect(repo.mocks.markSent).not.toHaveBeenCalled();
        }),
      );
    });

    it.effect('skips the sms channel when the recipient has no phone', () => {
      const repo = makeRepo();
      return run(repo.layer, (svc) =>
        Effect.gen(function* () {
          // recipient.phone is null — nothing to dial, so no ledger row either.
          yield* svc.notify(recipient, lowStockEvent, [SMS]);
          expect(repo.mocks.recordPending).not.toHaveBeenCalled();
          expect(mockTexterSend).not.toHaveBeenCalled();
        }),
      );
    });

    it.effect(
      'records the sms channel and marks it failed through the stub transport',
      () => {
        // The Phase-2 stub rejects every send; the row must land as failed,
        // never sent, and the email transport must stay untouched.
        mockTexterSend.mockRejectedValue(new Error('sms not implemented'));
        const repo = makeRepo();
        return run(repo.layer, (svc) =>
          Effect.gen(function* () {
            yield* svc.notify(smsRecipient, lowStockEvent, [SMS]);
            expect(repo.mocks.recordPending).toHaveBeenCalledTimes(1);
            expect(repo.mocks.recordPending.mock.calls[0]![0].channel).toBe(SMS);
            expect(mockTexterSend).toHaveBeenCalledTimes(1);
            expect(repo.mocks.markFailed).toHaveBeenCalledTimes(1);
            expect(repo.mocks.markSent).not.toHaveBeenCalled();
            expect(mockSend).not.toHaveBeenCalled();
          }),
        );
      },
    );

    it.effect('marks the sms ledger row sent when the transport succeeds', () => {
      // Proves the seam is drop-in: a transport that resolves drives the same
      // success reconciliation as email, no service change required.
      mockTexterSend.mockResolvedValue({ id: 'sms-1' });
      const repo = makeRepo();
      return run(repo.layer, (svc) =>
        Effect.gen(function* () {
          yield* svc.notify(smsRecipient, lowStockEvent, [SMS]);
          expect(mockTexterSend).toHaveBeenCalledTimes(1);
          expect(repo.mocks.markSent).toHaveBeenCalledWith('notif-1', 'sms-1');
          expect(repo.mocks.markFailed).not.toHaveBeenCalled();
        }),
      );
    });

    // Live clock: the retry backoff uses real delays that a TestClock would
    // freeze, so this case runs under it.live.
    it.live('marks failed after the provider keeps failing', () => {
      mockSend.mockRejectedValue(new Error('smtp down'));
      const repo = makeRepo();
      return run(repo.layer, (svc) =>
        Effect.gen(function* () {
          yield* svc.notify(recipient, lowStockEvent, [EMAIL]);
          // 1 initial attempt + 3 bounded retries
          expect(mockSend).toHaveBeenCalledTimes(4);
          expect(repo.mocks.markFailed).toHaveBeenCalledTimes(1);
          expect(repo.mocks.markSent).not.toHaveBeenCalled();
        }),
      );
    });
  });

  describe('runScan', () => {
    it.effect('alerts opted-in staff, skipping opt-outs and missing emails', () => {
      mockSend.mockResolvedValue({ id: 'provider-1' });
      const repo = makeRepo({
        findAudience: vi.fn(() =>
          Effect.succeed([
            candidate({ userId: 'in', email: 'in@test', emailEnabled: null }),
            candidate({ userId: 'out', email: 'out@test', emailEnabled: false }),
            candidate({ userId: 'noemail', email: null, emailEnabled: null }),
          ]),
        ),
      });
      return run(repo.layer, (svc) =>
        Effect.gen(function* () {
          yield* svc.runScan;
          // 1 low-stock item × 1 eligible recipient ('in')
          expect(repo.mocks.recordPending).toHaveBeenCalledTimes(1);
          const arg = repo.mocks.recordPending.mock.calls[0]![0];
          expect(arg.userId).toBe('in');
          expect(arg.category).toBe(NotificationCategory.INVENTORY_ALERTS);
        }),
      );
    });

    it.effect('does nothing when there are no low-stock items', () => {
      const repo = makeRepo({ findLowStock: vi.fn(() => Effect.succeed([])) });
      return run(repo.layer, (svc) =>
        Effect.gen(function* () {
          yield* svc.runScan;
          expect(repo.mocks.findAudience).not.toHaveBeenCalled();
          expect(repo.mocks.recordPending).not.toHaveBeenCalled();
        }),
      );
    });
  });
});
