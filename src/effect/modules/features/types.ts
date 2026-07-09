import type {
  tenantEntitlementProfiles,
  tenantFeatureOverrides,
} from '../../platform/db/schema';

export type TenantEntitlementProfileRow =
  typeof tenantEntitlementProfiles.$inferSelect;
export type TenantFeatureOverrideRow =
  typeof tenantFeatureOverrides.$inferSelect;
