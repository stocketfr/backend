import { afterEach, describe, expect, it } from 'vitest';
import { buildSeedPoolConfig, readSeedOptions } from './config';

const savedEnv = new Map<string, string | undefined>();
const envKeys = [
  'DATABASE_URL',
  'SEED_DATABASE_URL',
  'DB_POOL_MAX',
  'DB_SSL',
  'DB_SSL_REJECT_UNAUTHORIZED',
] as const;

const rememberEnv = () => {
  for (const key of envKeys) {
    if (!savedEnv.has(key)) {
      savedEnv.set(key, process.env[key]);
    }
  }
};

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  savedEnv.clear();
});

describe('readSeedOptions', () => {
  it('ignores the pnpm argument separator before tenant options', () => {
    expect(readSeedOptions(['--', '--tenant-slug', 'rbi'], {})).toMatchObject({
      tenantSlug: 'rbi',
      help: false,
    });
  });

  it('resolves --tenant as a slug when it is not a UUID', () => {
    expect(readSeedOptions(['--tenant', 'rbi'], {})).toMatchObject({
      tenantSlug: 'rbi',
      help: false,
    });
  });
});

describe('buildSeedPoolConfig', () => {
  it('prefers SEED_DATABASE_URL over the app DATABASE_URL', () => {
    rememberEnv();
    process.env.SEED_DATABASE_URL =
      'postgresql://postgres:postgres@localhost:5432/stocket_inventory';
    process.env.DATABASE_URL =
      'postgresql://postgres:postgres@postgres:5432/stocket_inventory';
    process.env.DB_POOL_MAX = '20';
    delete process.env.DB_SSL;

    expect(buildSeedPoolConfig()).toMatchObject({
      connectionString:
        'postgresql://postgres:postgres@localhost:5432/stocket_inventory',
      max: 20,
    });
  });
});
