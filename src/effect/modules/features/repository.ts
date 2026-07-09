import { Effect } from 'effect';
import { eq, sql } from 'drizzle-orm';
import {
  EntitlementSource,
  type FeatureKey,
  type PlanKey,
} from '@stocket/types/features';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
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

export class FeaturesRepository extends Effect.Service<FeaturesRepository>()(
  '@stocket/effect/features/FeaturesRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;

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
          const tenantScope = tenantQuery.forTenant(tenantId);
          const rows = await db
            .select()
            .from(tenantEntitlementProfiles)
            .where(tenantScope.whereTenant(tenantEntitlementProfiles))
            .limit(1);
          return rows[0] ?? null;
        });

      const listOverrides = (tenantId: string) =>
        tryAsync('load tenant feature overrides', async () => {
          const tenantScope = tenantQuery.forTenant(tenantId);
          return db
            .select()
            .from(tenantFeatureOverrides)
            .where(tenantScope.whereTenant(tenantFeatureOverrides));
        });

      const upsertPlan = (
        tenantId: string,
        planKey: PlanKey,
        actorUserId: string,
      ) =>
        tryAsync('upsert tenant entitlement profile', async () => {
          const tenantScope = tenantQuery.forTenant(tenantId);
          await db
            .insert(tenantEntitlementProfiles)
            .values(
              tenantScope.insertValues({
                plan_key: planKey,
                source: EntitlementSource.MANUAL,
                updated_by: actorUserId,
                updated_at: new Date(),
              }),
            )
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
          const tenantScope = tenantQuery.forTenant(tenantId);
          await db
            .insert(tenantFeatureOverrides)
            .values(
              tenantScope.insertValues({
                feature_key: featureKey,
                enabled: input.enabled,
                reason: input.reason ?? null,
                expires_at: input.expires_at ?? null,
                updated_by: actorUserId,
                updated_at: new Date(),
              }),
            )
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
          const tenantScope = tenantQuery.forTenant(tenantId);
          await db
            .delete(tenantFeatureOverrides)
            .where(
              tenantScope.whereTenant(
                tenantFeatureOverrides,
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
    dependencies: [TenantQuery.Default],
  },
) {}
