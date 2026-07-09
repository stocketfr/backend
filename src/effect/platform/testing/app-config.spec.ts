import { ConfigProvider, Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { AppConfig } from '../config/app-config';

const runWithEnv = (values: Record<string, string>) =>
  Effect.runPromise(
    AppConfig.pipe(
      Effect.provide(AppConfig.Default),
      Effect.withConfigProvider(
        ConfigProvider.fromMap(new Map(Object.entries(values))),
      ),
    ),
  );

describe('AppConfig', () => {
  it('derives runtime flags from NODE_ENV', async () => {
    const config = await runWithEnv({
      NODE_ENV: 'staging',
      BETTER_AUTH_SECRET: 'secret',
      CORS_ORIGIN: 'https://app.stocket.fr, http://localhost:3000',
    });

    expect(config).toMatchObject({
      nodeEnv: 'staging',
      isProduction: false,
      isStaging: true,
      isDevelopment: false,
      isTest: false,
      isVitest: false,
      isTestLike: false,
      isDevLike: false,
      hasBetterAuthSecret: true,
      corsOrigins: ['https://app.stocket.fr', 'http://localhost:3000'],
    });
  });

  it('defaults to development and treats blank optional secrets as missing', async () => {
    const config = await runWithEnv({ BETTER_AUTH_SECRET: '' });

    expect(config.nodeEnv).toBe('development');
    expect(config.isDevelopment).toBe(true);
    expect(config.isDevLike).toBe(true);
    expect(config.isTestLike).toBe(false);
    expect(config.hasBetterAuthSecret).toBe(false);
    expect(config.e2eSeedSecret).toBeNull();
    expect(config.corsOrigins).toEqual([]);
  });

  it('captures the optional E2E seed secret', async () => {
    const config = await runWithEnv({
      NODE_ENV: 'development',
      E2E_SEED_SECRET: 'seed-secret',
      VITEST: 'true',
    });

    expect(config.e2eSeedSecret).toBe('seed-secret');
    expect(config.isVitest).toBe(true);
    expect(config.isTestLike).toBe(true);
  });
});
