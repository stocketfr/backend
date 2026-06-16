// Integration tests for the SQL-level behaviours of NotificationsRepository:
// the ON CONFLICT DO NOTHING dedupe against the partial unique index, the
// preference upsert, and ledger status transitions. Requires Postgres on :5432
// (`pnpm test:integration`); runs under DEFAULT_TENANT_ID in test mode.
//
// NOTE: the permission-filtered audience join (findAudience) is intentionally
// not covered here yet — it needs user/role/role_permission/user_role +
// inventory seeding helpers. Tracked as a follow-up (see plan "Verification").
import { Effect, Layer } from 'effect';
import { eq } from 'drizzle-orm';
import {
  NotificationCategory,
  NotificationChannel,
} from '@stocket/types/notifications';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
} from '../../testing/integration-layer';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { notifications } from '../../platform/db/schema';
import {
  NotificationsRepository,
  type RecordPendingParams,
} from './repository';

let db: DrizzleDb;
let TestLayer: Layer.Layer<NotificationsRepository>;

beforeAll(() => {
  db = getTestDb();
  TestLayer = NotificationsRepository.Default.pipe(
    Layer.provide(makeTestDrizzleLayer()),
  );
});

afterAll(() => closeTestDb());
beforeEach(() => truncateAll());

const run = <A, E>(
  effect: Effect.Effect<A, E, NotificationsRepository>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const withRepo = <A, E>(
  body: (repo: NotificationsRepository) => Effect.Effect<A, E, never>,
) => run(Effect.flatMap(NotificationsRepository, body));

const pending = (over: Partial<RecordPendingParams> = {}): RecordPendingParams => ({
  userId: 'user-1',
  eventKind: 'low-stock',
  category: NotificationCategory.INVENTORY_ALERTS,
  channel: NotificationChannel.EMAIL,
  dedupeKey: 'low-stock:p1:l1:user-1:email:2026-06-14',
  ...over,
});

describe('NotificationsRepository Integration', () => {
  describe('recordPending dedupe', () => {
    it('returns an id the first time and null on a duplicate dedupe key', async () => {
      const first = await withRepo((repo) => repo.recordPending(pending()));
      const second = await withRepo((repo) => repo.recordPending(pending()));

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('allows a different dedupe key to insert', async () => {
      await withRepo((repo) => repo.recordPending(pending()));
      const other = await withRepo((repo) =>
        repo.recordPending(
          pending({ dedupeKey: 'low-stock:p1:l1:user-2:email:2026-06-14' }),
        ),
      );

      expect(other).not.toBeNull();
    });

    it('never deduplicates rows with a null dedupe key (transactional sends)', async () => {
      const a = await withRepo((repo) =>
        repo.recordPending(pending({ dedupeKey: null })),
      );
      const b = await withRepo((repo) =>
        repo.recordPending(pending({ dedupeKey: null })),
      );

      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a).not.toBe(b);
    });
  });

  describe('ledger status transitions', () => {
    it('marks a row sent with the provider message id', async () => {
      const id = await withRepo((repo) => repo.recordPending(pending()));
      await withRepo((repo) => repo.markSent(id!, 'provider-xyz'));

      const [row] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, id!));
      expect(row?.status).toBe('sent');
      expect(row?.provider_message_id).toBe('provider-xyz');
      expect(row?.sent_at).not.toBeNull();
    });

    it('marks a row failed with the error message', async () => {
      const id = await withRepo((repo) => repo.recordPending(pending()));
      await withRepo((repo) => repo.markFailed(id!, 'smtp down'));

      const [row] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, id!));
      expect(row?.status).toBe('failed');
      expect(row?.error).toBe('smtp down');
    });
  });

  describe('preferences upsert + read', () => {
    it('round-trips a stored preference and overwrites on re-upsert', async () => {
      await withRepo((repo) =>
        repo.upsertPreferences('user-1', [
          {
            category: NotificationCategory.INVENTORY_ALERTS,
            channel: NotificationChannel.EMAIL,
            enabled: false,
          },
        ]),
      );

      const first = await withRepo((repo) => repo.findPreferences('user-1'));
      expect(first).toContainEqual({
        category: 'inventory_alerts',
        channel: 'email',
        enabled: false,
      });

      // Re-upsert the same (tenant, user, category, channel) flips enabled
      // via ON CONFLICT DO UPDATE rather than inserting a second row.
      await withRepo((repo) =>
        repo.upsertPreferences('user-1', [
          {
            category: NotificationCategory.INVENTORY_ALERTS,
            channel: NotificationChannel.EMAIL,
            enabled: true,
          },
        ]),
      );

      const second = await withRepo((repo) => repo.findPreferences('user-1'));
      expect(second).toHaveLength(1);
      expect(second[0]?.enabled).toBe(true);
    });

    it('scopes preferences to the requested user', async () => {
      await withRepo((repo) =>
        repo.upsertPreferences('user-1', [
          {
            category: NotificationCategory.INVENTORY_ALERTS,
            channel: NotificationChannel.EMAIL,
            enabled: false,
          },
        ]),
      );

      const other = await withRepo((repo) => repo.findPreferences('user-2'));
      expect(other).toHaveLength(0);
    });
  });
});
