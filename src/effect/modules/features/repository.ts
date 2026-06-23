import { Effect } from 'effect';
import { and, eq, sql } from 'drizzle-orm';
import {
  EntitlementSource,
  type FeatureKey,
  type PlanKey,
} from '@stocket/types/features';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import {
  organizations,
  tenantEntitlementProfiles,
  tenantFeatureOverrides,
} from '../../platform/db/schema';
import { makeTryAsync } from '../../platform/effect/try-async';
import { FeaturesInfrastructureError } from './features.errors';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new FeaturesInfrastructureError({
      action,
      cause,
      messageKey: 'features.repositoryFailed',
    }),
);

export type TenantEntitlementProfileRow =
  typeof tenantEntitlementProfiles.$inferSelect;
export type TenantFeatureOverrideRow =
  typeof tenantFeatureOverrides.$inferSelect;

export class FeaturesRepository extends Effect.Service<FeaturesRepository>()(
  '@stocket/effect/features/FeaturesRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;

      const tenantExists = (tenantId: string) =>
        tryAsync('check tenant exists', async () => {
          const rows = await db
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, tenantId))
            .limit(1);
          return rows.length > 0;
        });

      const findProfile = (tenantId: string) =>
        tryAsync('load tenant entitlement profile', async () => {
          const rows = await db
            .select()
            .from(tenantEntitlementProfiles)
            .where(eq(tenantEntitlementProfiles.tenant_id, tenantId))
            .limit(1);
          return rows[0] ?? null;
        });

      const listOverrides = (tenantId: string) =>
        tryAsync('load tenant feature overrides', async () =>
          db
            .select()
            .from(tenantFeatureOverrides)
            .where(eq(tenantFeatureOverrides.tenant_id, tenantId)),
        );

      const upsertPlan = (
        tenantId: string,
        planKey: PlanKey,
        actorUserId: string,
      ) =>
        tryAsync('upsert tenant entitlement profile', async () => {
          await db
            .insert(tenantEntitlementProfiles)
            .values({
              tenant_id: tenantId,
              plan_key: planKey,
              source: EntitlementSource.MANUAL,
              updated_by: actorUserId,
              updated_at: new Date(),
            })
            .onConflictDoUpdate({
              target: tenantEntitlementProfiles.tenant_id,
              set: {
                plan_key: sql`excluded.plan_key`,
                source: EntitlementSource.MANUAL,
                updated_by: actorUserId,
                updated_at: new Date(),
              },
            });
        });

      const upsertOverride = (
        tenantId: string,
        featureKey: FeatureKey,
        input: {
          readonly enabled: boolean;
          readonly reason?: string | null;
          readonly expires_at?: Date | null;
        },
        actorUserId: string,
      ) =>
        tryAsync('upsert tenant feature override', async () => {
          await db
            .insert(tenantFeatureOverrides)
            .values({
              tenant_id: tenantId,
              feature_key: featureKey,
              enabled: input.enabled,
              reason: input.reason ?? null,
              expires_at: input.expires_at ?? null,
              updated_by: actorUserId,
              updated_at: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                tenantFeatureOverrides.tenant_id,
                tenantFeatureOverrides.feature_key,
              ],
              set: {
                enabled: sql`excluded.enabled`,
                reason: sql`excluded.reason`,
                expires_at: sql`excluded.expires_at`,
                updated_by: actorUserId,
                updated_at: new Date(),
              },
            });
        });

      const deleteOverride = (tenantId: string, featureKey: FeatureKey) =>
        tryAsync('delete tenant feature override', async () => {
          await db
            .delete(tenantFeatureOverrides)
            .where(
              and(
                eq(tenantFeatureOverrides.tenant_id, tenantId),
                eq(tenantFeatureOverrides.feature_key, featureKey),
              ),
            );
        });

      return {
        tenantExists,
        findProfile,
        listOverrides,
        upsertPlan,
        upsertOverride,
        deleteOverride,
      };
    }),
  },
) {}

