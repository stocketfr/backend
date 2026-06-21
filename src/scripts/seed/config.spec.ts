import { afterEach, describe, expect, it } from 'vitest';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_NAME,
  DEFAULT_TENANT_SLUG,
} from '../../effect/platform/tenancy/tenant-constants';
import {
  buildSeedPoolConfig,
  readSeedOptions,
  resolveSeedTenant,
} from './config';

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

  it('requires DATABASE_URL when SEED_DATABASE_URL is not set', () => {
    rememberEnv();
    delete process.env.SEED_DATABASE_URL;
    delete process.env.DATABASE_URL;
    process.env.DB_POOL_MAX = '20';

    expect(() => buildSeedPoolConfig()).toThrow(
      'DATABASE_URL environment variable is required',
    );
  });
});

describe('resolveSeedTenant', () => {
  type TenantRow = {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };

  const makeResolveDb = (
    selectResults: ReadonlyArray<ReadonlyArray<TenantRow>>,
  ) => {
    const pendingResults = [...selectResults];
    const insertedRows: unknown[] = [];
    const executedQueries: unknown[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(pendingResults.shift() ?? []),
          }),
        }),
      }),
      insert: () => ({
        values: (row: unknown) => {
          insertedRows.push(row);
          return {
            onConflictDoNothing: () => Promise.resolve(undefined),
          };
        },
      }),
      execute: (query: unknown) => {
        executedQueries.push(query);
        return Promise.resolve({ rows: [] });
      },
    };

    return {
      db: db as unknown as NodePgDatabase,
      insertedRows,
      executedQueries,
    };
  };

  it('ensures the default tenant and hostname for the implicit seed target', async () => {
    const { db, insertedRows, executedQueries } = makeResolveDb([
      [
        {
          id: DEFAULT_TENANT_ID,
          name: DEFAULT_TENANT_NAME,
          slug: DEFAULT_TENANT_SLUG,
        },
      ],
    ]);

    await expect(resolveSeedTenant(db, { help: false })).resolves.toEqual({
      id: DEFAULT_TENANT_ID,
      name: DEFAULT_TENANT_NAME,
      slug: DEFAULT_TENANT_SLUG,
    });
    expect(insertedRows).toEqual([
      {
        id: DEFAULT_TENANT_ID,
        name: DEFAULT_TENANT_NAME,
        slug: DEFAULT_TENANT_SLUG,
      },
    ]);
    expect(executedQueries).toHaveLength(1);
  });

  it('does not create explicitly requested tenants', async () => {
    const { db, insertedRows } = makeResolveDb([[]]);

    await expect(
      resolveSeedTenant(db, { help: false, tenantSlug: 'missing' }),
    ).rejects.toThrow(
      'Seed tenant not found for slug "missing". Create the tenant first, then rerun the seed.',
    );
    expect(insertedRows).toEqual([]);
  });
});
