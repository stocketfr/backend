import { normalizeBetterAuthBaseUrl } from './auth-base-url';

describe('normalizeBetterAuthBaseUrl', () => {
  it('adds the auth base path when only the origin is configured', () => {
    expect(normalizeBetterAuthBaseUrl('https://default.stocket.fr')).toBe(
      'https://default.stocket.fr/api/auth',
    );
  });

  it('upgrades the legacy /api value to /api/auth', () => {
    expect(normalizeBetterAuthBaseUrl('https://default.stocket.fr/api')).toBe(
      'https://default.stocket.fr/api/auth',
    );
  });

  it('preserves an explicit auth base URL', () => {
    expect(
      normalizeBetterAuthBaseUrl('https://default.stocket.fr/api/auth'),
    ).toBe('https://default.stocket.fr/api/auth');
  });

  it('normalizes trailing slashes', () => {
    expect(
      normalizeBetterAuthBaseUrl('https://default.stocket.fr/api/auth/'),
    ).toBe('https://default.stocket.fr/api/auth');
  });
});
