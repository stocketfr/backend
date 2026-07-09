import { describe, expect, it } from 'vitest';
import { isE2eSeedAllowed } from './access';

const config = (
  overrides: Parameters<typeof isE2eSeedAllowed>[0],
): Parameters<typeof isE2eSeedAllowed>[0] => overrides;

describe('isE2eSeedAllowed', () => {
  it('allows development without a configured secret', () => {
    expect(
      isE2eSeedAllowed(
        config({
          e2eSeedSecret: null,
          isDevelopment: true,
          isProduction: false,
        }),
        undefined,
      ),
    ).toBe(true);
  });

  it('fails closed outside development when the secret is missing', () => {
    expect(
      isE2eSeedAllowed(
        config({
          e2eSeedSecret: null,
          isDevelopment: false,
          isProduction: false,
        }),
        undefined,
      ),
    ).toBe(false);
  });

  it('rejects production even when a matching secret is provided', () => {
    expect(
      isE2eSeedAllowed(
        config({
          e2eSeedSecret: 'seed-secret',
          isDevelopment: false,
          isProduction: true,
        }),
        'seed-secret',
      ),
    ).toBe(false);
  });

  it('requires the configured secret when one is present', () => {
    const appConfig = config({
      e2eSeedSecret: 'seed-secret',
      isDevelopment: true,
      isProduction: false,
    });

    expect(isE2eSeedAllowed(appConfig, 'wrong-secret')).toBe(false);
    expect(isE2eSeedAllowed(appConfig, 'seed-secret')).toBe(true);
  });
});
