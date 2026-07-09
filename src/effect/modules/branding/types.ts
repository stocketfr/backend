import type { brandingSettings } from '../../platform/db/schema';

export type BrandingSettingsRow = typeof brandingSettings.$inferSelect;
