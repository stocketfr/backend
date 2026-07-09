import type { BrandingResponseDto } from '@stocket/types/branding';
import { DEFAULT_BRANDING, POWERED_BY } from './branding.constants';
import type { BrandingSettingsRow } from './types';

export const toDefaultBrandingResponse = (): BrandingResponseDto => ({
  ...DEFAULT_BRANDING,
  powered_by: POWERED_BY,
  updated_at: new Date(),
});

export const toBrandingResponse = (
  settings: BrandingSettingsRow,
): BrandingResponseDto => ({
  app_name: settings.app_name,
  tagline: settings.tagline,
  logo_url: settings.logo_url,
  favicon_url: settings.favicon_url,
  primary_color: settings.primary_color,
  powered_by: POWERED_BY,
  updated_at: settings.updated_at,
});
