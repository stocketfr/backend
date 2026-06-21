import { HttpServerRequest } from '@effect/platform';
import { describe, expect, it } from 'vitest';
import {
  getTenantSlugFromHost,
  hostnameForTenantSlug,
  isAllowedPlatformOrTenantOrigin,
  isPlatformHost,
  isTenantSubdomain,
  normalizeHost,
  resolveRequestHost,
} from '../tenancy/host';

const withEnv = <A>(
  values: Record<string, string | undefined>,
  run: () => A,
): A => {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

describe('platform host helpers', () => {
  it('normalizes host casing, ports, lists, and trailing dots', () => {
    expect(normalizeHost(' App.Stocket.FR:443. ')).toBe('app.stocket.fr');
    expect(normalizeHost('Tenant.Stocket.FR, proxy.local')).toBe(
      'tenant.stocket.fr',
    );
  });

  it('recognizes platform hosts separately from tenant hosts', () => {
    expect(isPlatformHost('app.stocket.fr')).toBe(true);
    expect(isPlatformHost('localhost:3000')).toBe(true);
    expect(isTenantSubdomain('app.stocket.fr')).toBe(false);
    expect(isTenantSubdomain('localhost:3000')).toBe(false);
  });

  it('accepts exactly one DNS-safe tenant label under the base domain', () => {
    expect(getTenantSlugFromHost('tenant-1.stocket.fr')).toBe('tenant-1');
    expect(getTenantSlugFromHost('tenant-1.localhost:3000')).toBe('tenant-1');
    expect(getTenantSlugFromHost('tenant-1:3000')).toBeNull();
    expect(isTenantSubdomain('nested.tenant.stocket.fr')).toBe(false);
    expect(isTenantSubdomain('stocket.fr')).toBe(false);
    expect(isTenantSubdomain('Tenant.stocket.fr')).toBe(true);
  });

  it('rejects reserved tenant slugs', () => {
    expect(getTenantSlugFromHost('admin.stocket.fr')).toBeNull();
    expect(getTenantSlugFromHost('app.stocket.fr')).toBeNull();
    expect(getTenantSlugFromHost('superadmin.stocket.fr')).toBeNull();
  });

  it('builds tenant.localhost:3000 hostnames in local development', () => {
    expect(hostnameForTenantSlug('tenant-1')).toBe('tenant-1.localhost:3000');
  });

  it('requires TENANT_BASE_DOMAIN', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        TENANT_BASE_DOMAIN: undefined,
        PLATFORM_HOST: 'app.stocket.fr',
      },
      () => {
        expect(() => hostnameForTenantSlug('tenant-1')).toThrow(
          'TENANT_BASE_DOMAIN environment variable is required',
        );
      },
    );
  });

  it('requires PLATFORM_HOST', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        TENANT_BASE_DOMAIN: 'stocket.fr',
        PLATFORM_HOST: undefined,
      },
      () => {
        expect(() => isPlatformHost('app.stocket.fr')).toThrow(
          'PLATFORM_HOST environment variable is required',
        );
      },
    );
  });

  it('builds production tenant hostnames from TENANT_BASE_DOMAIN', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        TENANT_BASE_DOMAIN: 'stock.example.com',
        PLATFORM_HOST: 'app.stock.example.com',
      },
      () => {
        expect(hostnameForTenantSlug('tenant-1')).toBe(
          'tenant-1.stock.example.com',
        );
        expect(getTenantSlugFromHost('tenant-1.stock.example.com')).toBe(
          'tenant-1',
        );
      },
    );
  });

  it('falls back to the original request URL host when no Host header is present', () => {
    const request = HttpServerRequest.fromWeb(
      new Request('https://tenant.stocket.fr/api/v1/branding'),
    );

    expect(resolveRequestHost(request)).toBe('tenant.stocket.fr');
  });

  it('prefers the Host header over the original request URL host', () => {
    const request = HttpServerRequest.fromWeb(
      new Request('https://ignored.example.com/api/v1/branding', {
        headers: { host: 'tenant.stocket.fr' },
      }),
    );

    expect(resolveRequestHost(request)).toBe('tenant.stocket.fr');
  });

  it('trusts x-forwarded-host only from trusted remote addresses', () => {
    const request = HttpServerRequest.fromWeb(
      new Request('https://ignored.example.com/api/v1/branding', {
        headers: {
          host: 'tenant.stocket.fr',
          'x-forwarded-host': 'forwarded.stocket.fr',
        },
      }),
    );

    expect(
      resolveRequestHost(request.modify({ remoteAddress: '127.0.0.1' })),
    ).toBe('forwarded.stocket.fr');
    expect(
      resolveRequestHost(request.modify({ remoteAddress: '203.0.113.10' })),
    ).toBe('tenant.stocket.fr');
  });

  it('falls back to Host when a trusted forwarded host is invalid', () => {
    const request = HttpServerRequest.fromWeb(
      new Request('https://ignored.example.com/api/v1/branding', {
        headers: {
          host: 'tenant.stocket.fr',
          'x-forwarded-host': '',
        },
      }),
    );

    expect(
      resolveRequestHost(request.modify({ remoteAddress: '127.0.0.1' })),
    ).toBe('tenant.stocket.fr');
  });

  it('validates same-origin platform and tenant origins', () => {
    expect(isAllowedPlatformOrTenantOrigin('https://app.stocket.fr')).toBe(
      true,
    );
    expect(isAllowedPlatformOrTenantOrigin('https://tenant.stocket.fr')).toBe(
      true,
    );
    expect(isAllowedPlatformOrTenantOrigin('https://example.com')).toBe(false);
  });
});
