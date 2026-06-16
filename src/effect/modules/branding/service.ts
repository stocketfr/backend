import { Effect } from 'effect';
import { and, eq } from 'drizzle-orm';
import type {
  BrandingResponseDto,
  UpdateBrandingDto,
} from '@stocket/types/branding';
import { makeTryAsync } from '../../platform/effect/try-async';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { brandingSettings } from '../../platform/db/schema';
import {
  DEFAULT_TENANT_ID,
  getRequestTenantId,
  requireRequestTenantId,
  type TenantNotResolved,
} from '../../platform/tenancy/tenant-context';
import {
  BRANDING_SETTINGS_ID,
  DEFAULT_BRANDING,
  POWERED_BY,
} from './branding.constants';
import { toBrandingResponse } from './branding.utils';
import { BrandingInfrastructureError } from './branding.errors';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new BrandingInfrastructureError({
      action,
      cause,
      messageKey: 'branding.repositoryFailed',
    }),
);

export class BrandingService extends Effect.Service<BrandingService>()(
  '@stocket/effect/branding/BrandingService',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;

      const get = (): Effect.Effect<
        BrandingResponseDto,
        BrandingInfrastructureError
      > =>
        Effect.gen(function* () {
          const tenantId = (yield* getRequestTenantId) ?? DEFAULT_TENANT_ID;
          const settings = yield* tryAsync(
            'load branding settings',
            async () => {
              const rows = await db
                .select()
                .from(brandingSettings)
                .where(
                  and(
                    eq(brandingSettings.id, BRANDING_SETTINGS_ID),
                    eq(brandingSettings.tenant_id, tenantId),
                  ),
                )
                .limit(1);
              return rows[0] ?? null;
            },
          );
          return settings
            ? toBrandingResponse(settings)
            : {
                ...DEFAULT_BRANDING,
                powered_by: POWERED_BY,
                updated_at: new Date(),
              };
        }).pipe(Effect.withSpan('BrandingService.get'));

      const update = (
        dto: UpdateBrandingDto,
        userId: string,
      ): Effect.Effect<
        BrandingResponseDto,
        BrandingInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* requireRequestTenantId;
          yield* tryAsync('upsert branding settings', () =>
            db
              .insert(brandingSettings)
              .values({
                id: BRANDING_SETTINGS_ID,
                tenant_id: tenantId,
                app_name: dto.app_name ?? DEFAULT_BRANDING.app_name,
                tagline: dto.tagline ?? DEFAULT_BRANDING.tagline,
                primary_color:
                  dto.primary_color ?? DEFAULT_BRANDING.primary_color,
                ...dto,
                updated_by: userId,
                updated_at: new Date(),
              })
              .onConflictDoUpdate({
                target: [brandingSettings.tenant_id, brandingSettings.id],
                set: {
                  ...dto,
                  updated_by: userId,
                  updated_at: new Date(),
                },
              }),
          );

          const rows = yield* tryAsync('load persisted branding settings', () =>
            db
              .select()
              .from(brandingSettings)
              .where(
                and(
                  eq(brandingSettings.id, BRANDING_SETTINGS_ID),
                  eq(brandingSettings.tenant_id, tenantId),
                ),
              )
              .limit(1),
          );

          if (!rows[0]) {
            return yield* Effect.fail(
              new BrandingInfrastructureError({
                action: 'load persisted branding settings',
                messageKey: 'branding.repositoryFailed',
              }),
            );
          }

          return toBrandingResponse(rows[0]);
        }).pipe(
          Effect.withSpan('BrandingService.update', { attributes: { userId } }),
        );

      return { get, update };
    }),
  },
) {}
