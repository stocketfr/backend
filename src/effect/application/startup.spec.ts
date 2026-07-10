import { describe, expect, it } from 'vitest';
import { shouldRunStartupMigrations } from './startup';

describe('shouldRunStartupMigrations', () => {
  it.each([
    ['development', false, true],
    ['development', true, true],
    ['staging', false, true],
    ['staging', true, true],
    ['production', false, false],
    ['production', true, true],
  ] as const)(
    'uses nodeEnv=%s and runBetterAuthMigrations=%s',
    (nodeEnv, runBetterAuthMigrations, expected) => {
      expect(
        shouldRunStartupMigrations({ nodeEnv, runBetterAuthMigrations }),
      ).toBe(expected);
    },
  );
});
