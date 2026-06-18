// Integration tests for the SQL-level behaviours of NotificationsRepository:
// the ON CONFLICT DO NOTHING dedupe against the partial unique index, the
// preference upsert, audience resolution, and ledger status transitions.
// Requires Postgres on :5432 (`pnpm test:integration`); runs under
// DEFAULT_TENANT_ID in test mode.
import { Effect, Layer } from 'effect';
import { eq, sql } from 'drizzle-orm';
import {
  NotificationCategory,
  NotificationChannel,
} from '@stocket/types/notifications';
import { Permission, Resource } from '@stocket/types/auth';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
} from '../../testing/integration-layer';
import type { DrizzleDb } from '../../platform/db/drizzle';
import {
  notificationPreferences,
  notifications,
  rolePermissions,
  userRoles,
} from '../../platform/db/schema';
import {
  ensureBetterAuthUserTable,
  seedBetterAuthUserRow,
  seedRole,
} from '../users/__fixtures__/seed-users';
import {
  NotificationsRepository,
  type RecordPendingParams,
} from './repository';

let db: DrizzleDb;
let TestLayer: Layer.Layer<NotificationsRepository>;

beforeAll(async () => {
  db = getTestDb();
  await ensureBetterAuthUserTable(db);
  TestLayer = NotificationsRepository.Default.pipe(
    Layer.provide(makeTestDrizzleLayer()),
  );
});

afterAll(() => closeTestDb());
beforeEach(async () => {
  await truncateAll();
  await ensureBetterAuthUserTable(db);
  await db.execute(sql`TRUNCATE TABLE "user" CASCADE`);
});

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

  describe('findAudience', () => {
    it('returns tenant users with inventory read permission and their email preference', async () => {
      const userId = '00000000-0000-4000-a000-000000000011';
      await seedBetterAuthUserRow(db, {
        id: userId,
        name: 'Inventory Reader',
        email: 'reader@example.com',
      });
      const role = await seedRole(db, { name: 'Inventory Reader' });
      await db.insert(rolePermissions).values({
        role_id: role.id,
        resource: Resource.INVENTORY,
        permission: Permission.READ,
      });
      await db.insert(userRoles).values({
        user_id: userId,
        role_id: role.id,
      });
      await db.insert(notificationPreferences).values({
        user_id: userId,
        category: NotificationCategory.INVENTORY_ALERTS,
        channel: NotificationChannel.EMAIL,
        enabled: false,
      });

      const audience = await withRepo((repo) =>
        repo.findAudience(NotificationCategory.INVENTORY_ALERTS),
      );

      expect(audience).toEqual([
        {
          userId,
          email: 'reader@example.com',
          locale: null,
          emailEnabled: false,
        },
      ]);
    });
  });
});
