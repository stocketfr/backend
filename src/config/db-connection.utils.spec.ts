import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDatabaseUrl, getPoolMax } from './db-connection.utils';

describe('database connection config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads DATABASE_URL when configured', () => {
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:5432/stocket_inventory',
    );

    expect(getDatabaseUrl()).toBe(
      'postgresql://postgres:postgres@localhost:5432/stocket_inventory',
    );
  });

  it('requires DATABASE_URL', () => {
    vi.stubEnv('DATABASE_URL', '');

    expect(() => getDatabaseUrl()).toThrow(
      'DATABASE_URL environment variable is required',
    );
  });

  it('keeps DB_POOL_MAX optional with an explicit default', () => {
    vi.stubEnv('DB_POOL_MAX', '');

    expect(getPoolMax()).toBe(20);
  });
});
