import { describe, expect, it } from '@effect/vitest';
import {
  BRANDING_SETTINGS_ID,
  DEFAULT_BRANDING,
  POWERED_BY,
} from './branding.constants';
import { toBrandingResponse, toDefaultBrandingResponse } from './mappers';
import type { BrandingSettingsRow } from './types';

const updatedAt = new Date('2026-02-01T00:00:00.000Z');

const makeBrandingSettings = (
  overrides: Partial<BrandingSettingsRow> = {},
): BrandingSettingsRow => ({
  id: BRANDING_SETTINGS_ID,
  tenant_id: '00000000-0000-4000-8000-000000000001',
  app_name: 'Warehouse HQ',
  tagline: 'Move stock cleanly',
  logo_url: 'https://cdn.example.com/logo.png',
  favicon_url: null,
  primary_color: '#0088cc',
  updated_at: updatedAt,
  updated_by: 'user-1',
  ...overrides,
});

describe('branding mappers', () => {
  it('maps persisted branding settings to the response contract', () => {
    expect(toBrandingResponse(makeBrandingSettings())).toEqual({
      app_name: 'Warehouse HQ',
      tagline: 'Move stock cleanly',
      logo_url: 'https://cdn.example.com/logo.png',
      favicon_url: null,
      primary_color: '#0088cc',
      powered_by: POWERED_BY,
      updated_at: updatedAt,
    });
  });

  it('builds the default response with powered_by metadata', () => {
    const result = toDefaultBrandingResponse();

    expect(result).toMatchObject({
      ...DEFAULT_BRANDING,
      powered_by: POWERED_BY,
    });
    expect(result.updated_at).toBeInstanceOf(Date);
  });
});
