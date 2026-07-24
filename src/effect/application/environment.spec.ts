import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertSafeApplicationEnvironment,
  parseApplicationPort,
} from './environment';

describe('parseApplicationPort', () => {
  it.each([
    ['1', 1],
    ['8080', 8080],
    ['65535', 65_535],
  ] as const)('parses valid TCP port %s', (value, expected) => {
    expect(parseApplicationPort(value)).toBe(expected);
  });

  it.each(['0', '-1', '1.5', '65536', 'not-a-number'])(
    'rejects invalid TCP port %s',
    (value) => {
      expect(() => parseApplicationPort(value)).toThrow(
        'PORT must be an integer between 1 and 65535',
      );
    },
  );
});

describe('assertSafeApplicationEnvironment', () => {
  const developmentDatabasePassword = ['post', 'gres'].join('');
  const productionEnv = {
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://app.stocket.fr',
    FRONTEND_URL: 'https://app.stocket.fr',
    BETTER_AUTH_URL: 'https://api.stocket.fr',
    DATABASE_URL: 'postgresql://stocket:secret@database.internal/stocket',
    S3_ENDPOINT: 'https://s3.fr-par.scw.cloud',
    S3_ACCESS_KEY_ID: 'production-key',
    S3_SECRET_ACCESS_KEY: 'production-secret',
  } satisfies NodeJS.ProcessEnv;

  it('accepts production-safe configuration', () => {
    expect(() =>
      assertSafeApplicationEnvironment('production', productionEnv),
    ).not.toThrow();
  });

  it.each([
    ['CORS_ORIGIN', 'http://localhost:3000'],
    ['CORS_ORIGIN', 'https://tenant.localhost'],
    ['FRONTEND_URL', 'http://localhost:3000'],
    ['BETTER_AUTH_URL', 'http://localhost:8080'],
    ['S3_ENDPOINT', 'http://localhost:9000'],
    ['DATABASE_URL', 'postgresql://stocket:secret@localhost/stocket'],
    ['DATABASE_URL', 'postgresql://stocket:secret@127.0.0.2/stocket'],
    ['DATABASE_URL', 'postgresql://stocket:secret@[::ffff:7f00:1]/stocket'],
    ['DATABASE_URL', 'postgresql://stocket:secret@[0:0:0:0:0:0:0:1]/stocket'],
    [
      'DATABASE_URL',
      'postgresql://stocket:secret@database/stocket?host=localhost',
    ],
    [
      'DATABASE_URL',
      'postgresql://stocket:secret@database/stocket?host=database&host=localhost',
    ],
    [
      'DATABASE_URL',
      'postgresql://stocket:secret@database/stocket?host=/var/run/postgresql',
    ],
  ] as const)('rejects a development %s', (name, value) => {
    expect(() =>
      assertSafeApplicationEnvironment('production', {
        ...productionEnv,
        [name]: value,
      }),
    ).toThrow(name);
  });

  it('rejects development database and object-storage credentials', () => {
    expect(() =>
      assertSafeApplicationEnvironment('production', {
        ...productionEnv,
        DATABASE_URL:
          'postgresql://safe:safe@database/stocket?user=postgres&password=postgres',
      }),
    ).toThrow('development postgres credentials');

    expect(() =>
      assertSafeApplicationEnvironment('production', {
        ...productionEnv,
        DATABASE_URL: 'postgresql://postgres:post%67res@database/stocket',
      }),
    ).toThrow('development postgres credentials');

    expect(() =>
      assertSafeApplicationEnvironment('production', {
        ...productionEnv,
        DATABASE_URL: `postgresql://safe:safe@database/stocket?user=safe&user=postgres&password=safe&password=${developmentDatabasePassword}`,
      }),
    ).toThrow('development postgres credentials');

    expect(() =>
      assertSafeApplicationEnvironment('production', {
        ...productionEnv,
        S3_ACCESS_KEY_ID: 'minio',
      }),
    ).toThrow('development MinIO credentials');
  });

  it.each(['E2E_SEED_SECRET', 'E2E_DATABASE_URL'] as const)(
    'rejects the %s E2E control',
    (name) => {
      expect(() =>
        assertSafeApplicationEnvironment('production', {
          ...productionEnv,
          [name]: 'enabled',
        }),
      ).toThrow('E2E controls');
    },
  );

  it.each(['true', 'yes', 'on', '1'])(
    'rejects the %s test runtime mode',
    (value) => {
      expect(() =>
        assertSafeApplicationEnvironment('production', {
          ...productionEnv,
          VITEST: value,
        }),
      ).toThrow('VITEST');
    },
  );

  it('accepts commas in singular URLs and empty list entries', () => {
    expect(() =>
      assertSafeApplicationEnvironment('production', {
        ...productionEnv,
        DATABASE_URL: 'postgresql://stocket:p,ass@database.internal/stocket',
        CORS_ORIGIN: 'https://app.stocket.fr,',
      }),
    ).not.toThrow();
  });

  it('does not constrain local development', () => {
    expect(() =>
      assertSafeApplicationEnvironment('development', {
        NODE_ENV: 'development',
        CORS_ORIGIN: 'http://localhost:3000',
        E2E_SEED_SECRET: 'local-secret',
      }),
    ).not.toThrow();
  });
});

describe('production launch contract', () => {
  it('keeps development Infisical environments out of production commands', () => {
    const packageJson = readFileSync('package.json', 'utf8');
    expect(packageJson).toContain(
      '"start:production": "NODE_ENV=production node dist/effect/main.cjs"',
    );
    expect(packageJson).toContain(
      '"start:production:worker": "NODE_ENV=production node dist/effect/task-worker.cjs"',
    );

    const unsafeCommands = packageJson
      .split('\n')
      .filter(
        (line) =>
          line.includes('production') &&
          line.includes('--env=dev') &&
          !line.includes('"start:local:'),
      );
    expect(unsafeCommands).toEqual([]);

    expect(readFileSync('justfile', 'utf8')).toContain(
      'start:\n  pnpm start:production',
    );
    expect(readFileSync('Dockerfile', 'utf8')).toContain(
      'CMD ["sh", "-c", "NODE_ENV=production exec node dist/effect/main.cjs"]',
    );
  });
});
