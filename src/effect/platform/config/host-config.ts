import { readRequiredHostEnv } from '@stocket/types/common';

export interface HostRuntimeConfig {
  readonly tenantBaseDomain: string;
  readonly platformHost: string;
  readonly isLocalRuntime: boolean;
  readonly reservedTenantSlugs: ReadonlySet<string>;
}

const DEFAULT_RESERVED_TENANT_SLUGS = [
  'app',
  'default',
  'api',
  'deploy',
  'www',
  'admin',
  'superadmin',
  'auth',
  'assets',
] as const;

const parseReservedTenantSlugs = (value: string | undefined) =>
  new Set(
    (value ?? DEFAULT_RESERVED_TENANT_SLUGS.join(','))
      .split(',')
      .map((slug) => slug.trim().toLowerCase())
      .filter(Boolean),
  );

export const readTenantBaseDomain = () =>
  readRequiredHostEnv('TENANT_BASE_DOMAIN');

export const readPlatformHost = () => readRequiredHostEnv('PLATFORM_HOST');

export const readIsLocalRuntime = () =>
  process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'staging';

export const readReservedTenantSlugs = () =>
  parseReservedTenantSlugs(process.env.RESERVED_TENANT_SLUGS);

export const readHostRuntimeConfig = (): HostRuntimeConfig => ({
  tenantBaseDomain: readTenantBaseDomain(),
  platformHost: readPlatformHost(),
  isLocalRuntime: readIsLocalRuntime(),
  reservedTenantSlugs: readReservedTenantSlugs(),
});
