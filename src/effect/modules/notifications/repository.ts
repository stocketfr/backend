import { Effect } from 'effect';
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  type NotificationCategory,
  NotificationChannel,
} from '@stocket/types/notifications';
import { Permission, Resource } from '@stocket/types/auth';
import { makeTryAsync } from '../../platform/effect/try-async';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import {
  betterAuthUsers,
  inventory,
  locations,
  notificationPreferences,
  notifications,
  organizations,
  products,
  rolePermissions,
  roles,
  userRoles,
} from '../../platform/db/schema';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { NotificationsInfrastructureError } from './notifications.errors';
import type { NotificationEventKind, NotificationStatus } from './types';

// A tenant user eligible for an alert, plus their stored email preference
// for the category (null when they've never set one — resolved via effectivePref).
export interface AudienceCandidate {
  readonly userId: string;
  readonly email: string | null;
  readonly locale: string | null;
  readonly emailEnabled: boolean | null;
}

export interface StoredPreferenceRow {
  readonly category: string;
  readonly channel: string;
  readonly enabled: boolean;
}

// A product/location below its reorder point for one tenant (drives low-stock
// alert events during the scan).
export interface LowStockItem {
  readonly productId: string;
  readonly locationId: string;
  readonly sku: string;
  readonly productName: string;
  readonly locationName: string;
  readonly quantity: number;
  readonly reorderPoint: number;
}

export interface RecordPendingParams {
  readonly userId: string;
  readonly eventKind: NotificationEventKind;
  readonly category: NotificationCategory;
  readonly channel: NotificationChannel;
  readonly dedupeKey: string | null;
}

export interface PreferenceInput {
  readonly category: NotificationCategory;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
}

const tryAsync = makeTryAsync(
  (action, cause) =>
    new NotificationsInfrastructureError({
      action,
      cause,
      messageKey: 'notifications.repositoryFailed',
    }),
);

type RepoEffect<A> = Effect.Effect<
  A,
  NotificationsInfrastructureError | TenantNotResolved
>;

export class NotificationsRepository extends Effect.Service<NotificationsRepository>()(
  '@stocket/effect/notifications/NotificationsRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;

      // Inserts the pending ledger row. ON CONFLICT DO NOTHING on the partial
      // unique dedupe_key index makes this atomically idempotent: a `null`
      // return means another row already claimed this dedupe key (a prior tick
      // or a concurrent scan instance), so the caller must skip delivery.
      const recordPending = (
        params: RecordPendingParams,
      ): RepoEffect<string | null> =>
        Effect.gen(function* () {
          const values = yield* tenantQuery.insertValues({
            user_id: params.userId,
            event_kind: params.eventKind,
            category: params.category,
            channel: params.channel,
            dedupe_key: params.dedupeKey,
            status: 'pending' satisfies NotificationStatus,
          });
          return yield* tryAsync('record pending notification', async () => {
            const rows = await db
              .insert(notifications)
              .values(values)
              .onConflictDoNothing()
              .returning({ id: notifications.id });
            return rows[0]?.id ?? null;
          });
        });

      const markSent = (
        id: string,
        providerMessageId: string | null,
      ): RepoEffect<void> =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(notifications, id);
          yield* tryAsync('mark notification sent', async () => {
            await db
              .update(notifications)
              .set({
                status: 'sent' satisfies NotificationStatus,
                provider_message_id: providerMessageId,
                sent_at: new Date(),
              })
              .where(where);
          });
        });

      const markFailed = (id: string, error: string): RepoEffect<void> =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(notifications, id);
          yield* tryAsync('mark notification failed', async () => {
            await db
              .update(notifications)
              .set({ status: 'failed' satisfies NotificationStatus, error })
              .where(where);
          });
        });

      // Products at/below their reorder point for the active tenant. Reuses the
      // same comparison the inventory dashboard uses; innerJoins drop orphaned
      // inventory rows (missing product/location).
      const findLowStock = (): RepoEffect<LowStockItem[]> =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            inventory,
            sql`${inventory.quantity} <= ${products.reorder_point}`,
          );
          return yield* tryAsync('find low stock items', async () => {
            return db
              .select({
                productId: inventory.product_id,
                locationId: inventory.location_id,
                sku: products.sku,
                productName: products.name,
                locationName: locations.name,
                quantity: inventory.quantity,
                reorderPoint: products.reorder_point,
              })
              .from(inventory)
              .innerJoin(products, eq(inventory.product_id, products.id))
              .innerJoin(locations, eq(inventory.location_id, locations.id))
              .where(where);
          });
        });

      // Every tenant id (cross-tenant; the scheduled scan iterates these and
      // provides a per-tenant request context before calling the others).
      const listTenantIds = (): RepoEffect<string[]> =>
        tryAsync('list tenant ids', async () => {
          const rows = await db
            .select({ id: organizations.id })
            .from(organizations);
          return rows.map((row) => row.id);
        });

      const findPreferences = (
        userId: string,
      ): RepoEffect<StoredPreferenceRow[]> =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            notificationPreferences,
            eq(notificationPreferences.user_id, userId),
            eq(notificationPreferences.channel, NotificationChannel.EMAIL),
          );
          return yield* tryAsync('load notification preferences', async () => {
            return db
              .select({
                category: notificationPreferences.category,
                channel: notificationPreferences.channel,
                enabled: notificationPreferences.enabled,
              })
              .from(notificationPreferences)
              .where(where);
          });
        });

      const upsertPreferences = (
        userId: string,
        prefs: ReadonlyArray<PreferenceInput>,
      ): RepoEffect<void> =>
        Effect.gen(function* () {
          if (prefs.length === 0) return;
          const values = yield* Effect.forEach(prefs, (p) =>
            tenantQuery.insertValues({
              user_id: userId,
              category: p.category,
              channel: p.channel,
              enabled: p.enabled,
            }),
          );
          yield* tryAsync('upsert notification preferences', async () => {
            await db
              .insert(notificationPreferences)
              .values(values)
              .onConflictDoUpdate({
                target: [
                  notificationPreferences.tenant_id,
                  notificationPreferences.user_id,
                  notificationPreferences.category,
                  notificationPreferences.channel,
                ],
                set: {
                  enabled: sql`excluded.enabled`,
                  updated_at: new Date(),
                },
              });
          });
        });

      // Audience resolver (D10): tenant users who hold inventory:read, joined to
      // their stored email preference for the category. The service applies
      // effectivePref to decide whether the email fires.
      const findAudience = (
        category: NotificationCategory,
      ): RepoEffect<AudienceCandidate[]> =>
        Effect.gen(function* () {
          const tenantScope = tenantQuery.forTenant(
            yield* tenantQuery.tenantId,
          );
          return yield* tryAsync('resolve notification audience', async () => {
            const emailPref = alias(notificationPreferences, 'email_pref');
            return db
              .selectDistinct({
                userId: betterAuthUsers.id,
                email: betterAuthUsers.email,
                locale: betterAuthUsers.locale,
                emailEnabled: emailPref.enabled,
              })
              .from(betterAuthUsers)
              .innerJoin(
                userRoles,
                and(
                  eq(userRoles.user_id, betterAuthUsers.id),
                  tenantScope.tenantPredicate(userRoles),
                ),
              )
              .innerJoin(
                roles,
                and(
                  eq(roles.id, userRoles.role_id),
                  tenantScope.tenantPredicate(roles),
                ),
              )
              .innerJoin(
                rolePermissions,
                and(
                  eq(rolePermissions.role_id, roles.id),
                  eq(rolePermissions.resource, Resource.INVENTORY),
                  eq(rolePermissions.permission, Permission.READ),
                ),
              )
              .leftJoin(
                emailPref,
                and(
                  eq(emailPref.user_id, betterAuthUsers.id),
                  tenantScope.tenantPredicate(emailPref),
                  eq(emailPref.category, category),
                  eq(emailPref.channel, NotificationChannel.EMAIL),
                ),
              );
          });
        });

      return {
        recordPending,
        markSent,
        markFailed,
        findLowStock,
        listTenantIds,
        findPreferences,
        upsertPreferences,
        findAudience,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
