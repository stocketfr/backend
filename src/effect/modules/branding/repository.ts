import { Effect } from 'effect';
import { eq } from 'drizzle-orm';
import type { UpdateBrandingDto } from '@stocket/types/branding';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { brandingSettings } from '../../platform/db/schema';
import { makeTryAsync } from '../../platform/effect/try-async';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import { BRANDING_SETTINGS_ID, DEFAULT_BRANDING } from './branding.constants';
import { BrandingInfrastructureError } from './branding.errors';

export type BrandingSettingsRow = typeof brandingSettings.$inferSelect;

const tryAsync = makeTryAsync(
  (action, cause) =>
    new BrandingInfrastructureError({
      action,
      cause,
      messageKey: 'branding.repositoryFailed',
    }),
);

export class BrandingRepository extends Effect.Service<BrandingRepository>()(
  '@stocket/effect/branding/BrandingRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;

      const findSettings = (tenantId: string) =>
        tryAsync('load branding settings', async () => {
          const tenantScope = tenantQuery.forTenant(tenantId);
          const rows = await db
            .select()
            .from(brandingSettings)
            .where(
              tenantScope.whereTenant(
                brandingSettings,
                eq(brandingSettings.id, BRANDING_SETTINGS_ID),
              ),
            )
            .limit(1);
          return rows[0] ?? null;
        });

      const upsertSettings = (
        tenantId: string,
        dto: UpdateBrandingDto,
        userId: string,
      ) =>
        tryAsync('upsert branding settings', async () => {
          const tenantScope = tenantQuery.forTenant(tenantId);
          await db
            .insert(brandingSettings)
            .values(
              tenantScope.insertValues({
                id: BRANDING_SETTINGS_ID,
                app_name: dto.app_name ?? DEFAULT_BRANDING.app_name,
                tagline: dto.tagline ?? DEFAULT_BRANDING.tagline,
                primary_color:
                  dto.primary_color ?? DEFAULT_BRANDING.primary_color,
                ...dto,
                updated_by: userId,
                updated_at: new Date(),
              }),
            )
            .onConflictDoUpdate({
              target: [brandingSettings.tenant_id, brandingSettings.id],
              set: {
                ...dto,
                updated_by: userId,
                updated_at: new Date(),
              },
            });
        });

      return {
        findSettings,
        upsertSettings,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
