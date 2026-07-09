import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import type { UpdateBrandingDto } from '@stocket/types/branding';
import { BRANDING_SETTINGS_ID, POWERED_BY } from './branding.constants';
import {
  makeBrandingWriteWorkflows,
  type BrandingWriteRepository,
} from './write';
import type { BrandingSettingsRow } from './types';

const tenantId = '00000000-0000-4000-8000-000000000001';
const userId = 'user-1';
const updatedAt = new Date('2026-02-01T00:00:00.000Z');

const makeBrandingSettings = (
  overrides: Partial<BrandingSettingsRow> = {},
): BrandingSettingsRow => ({
  id: BRANDING_SETTINGS_ID,
  tenant_id: tenantId,
  app_name: 'Warehouse HQ',
  tagline: 'Move stock cleanly',
  logo_url: null,
  favicon_url: null,
  primary_color: '#0088cc',
  updated_at: updatedAt,
  updated_by: userId,
  ...overrides,
});

const makeRepository = (
  overrides: Partial<BrandingWriteRepository> = {},
): BrandingWriteRepository => ({
  findSettings: () => Effect.succeed(makeBrandingSettings()),
  upsertSettings: () => Effect.void,
  ...overrides,
});

describe('makeBrandingWriteWorkflows', () => {
  it.effect('upserts settings, reloads them, and maps the response', () =>
    Effect.gen(function* () {
      const dto: UpdateBrandingDto = {
        app_name: 'Warehouse HQ',
        primary_color: '#0088cc',
      };
      const calls: string[] = [];
      let upsert:
        | {
            readonly tenantId: string;
            readonly dto: UpdateBrandingDto;
            readonly userId: string;
          }
        | undefined;

      const workflows = makeBrandingWriteWorkflows({
        repository: makeRepository({
          upsertSettings: (id, input, actorId) =>
            Effect.sync(() => {
              calls.push('upsert');
              upsert = { tenantId: id, dto: input, userId: actorId };
            }),
          findSettings: (id) =>
            Effect.sync(() => {
              calls.push(`find:${id}`);
              return makeBrandingSettings({
                tenant_id: id,
                app_name: 'Warehouse HQ',
              });
            }),
        }),
      });

      const result = yield* workflows.update(tenantId, dto, userId);

      expect(upsert).toEqual({ tenantId, dto, userId });
      expect(calls).toEqual(['upsert', `find:${tenantId}`]);
      expect(result).toMatchObject({
        app_name: 'Warehouse HQ',
        powered_by: POWERED_BY,
      });
    }),
  );

  it.effect('fails when the persisted settings cannot be reloaded', () =>
    Effect.gen(function* () {
      const workflows = makeBrandingWriteWorkflows({
        repository: makeRepository({
          findSettings: () => Effect.succeed(null),
        }),
      });

      const error = yield* Effect.flip(
        workflows.update(tenantId, { app_name: 'Missing' }, userId),
      );

      expect(error).toMatchObject({
        _tag: 'BrandingInfrastructureError',
        action: 'load persisted branding settings',
      });
    }),
  );
});
