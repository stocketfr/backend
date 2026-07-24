import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { getCommittedSqlMigrations } from './committed-sql-migrations';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const TSX_CLI = path.join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const MIGRATION_ENTRYPOINT = path.join(
  PROJECT_ROOT,
  'src',
  'effect',
  'pre-deploy-migrate.ts',
);
const SUPERADMIN_PASSWORD = 'predeploy-integration-password';

interface CommandResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const adminDatabaseUrl = (): string => {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/stocket_inventory_test',
  );
  url.pathname = '/postgres';
  return url.toString();
};

const temporaryDatabaseUrl = (databaseName: string): string => {
  const url = new URL(adminDatabaseUrl());
  url.pathname = `/${databaseName}`;
  return url.toString();
};

const createTemporaryDatabase = async (): Promise<{
  readonly name: string;
  readonly url: string;
}> => {
  const name = `stocket_migration_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new pg.Pool({ connectionString: adminDatabaseUrl() });
  try {
    await adminPool.query(`CREATE DATABASE "${name}"`);
  } finally {
    await adminPool.end();
  }
  return { name, url: temporaryDatabaseUrl(name) };
};

const dropTemporaryDatabase = async (databaseName: string): Promise<void> => {
  const adminPool = new pg.Pool({ connectionString: adminDatabaseUrl() });
  try {
    await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  } finally {
    await adminPool.end();
  }
};

const runMigrationCommand = (databaseUrl: string): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, MIGRATION_ENTRYPOINT], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: databaseUrl,
        DB_SSL: 'false',
        DB_POOL_MAX: '3',
        BETTER_AUTH_SECRET: 'predeploy-integration-auth-secret',
        BETTER_AUTH_URL: 'https://api.stocket.test',
        CORS_ORIGIN: 'https://app.stocket.test',
        FRONTEND_URL: 'https://app.stocket.test',
        PLATFORM_HOST: 'app.stocket.test',
        TENANT_BASE_DOMAIN: 'stocket.test',
        EMAIL_FROM: 'Stocket <test@stocket.test>',
        RESEND_API_KEY: 're_test_predeploy',
        SUPERADMIN_EMAIL: 'predeploy-admin@stocket.test',
        SUPERADMIN_NAME: 'Predeploy Admin',
        SUPERADMIN_PASSWORD,
        SUPERADMIN_ROTATE_PASSWORD: 'true',
        LOG_SQL: 'full',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });

const expectSuccessfulCommand = (result: CommandResult): void => {
  expect(
    result.code,
    `migration stderr:\n${result.stderr}\nmigration stdout:\n${result.stdout}`,
  ).toBe(0);
  const output = `${result.stdout}\n${result.stderr}`;
  expect(output).not.toContain(SUPERADMIN_PASSWORD);
  expect(output).not.toContain('CREATE TABLE');
  expect(output).not.toContain('INSERT INTO');
  expect(output).not.toContain('DATABASE_URL');
};

const preparePreviousProductionSchema = async (
  databaseUrl: string,
): Promise<void> => {
  const migrations = getCommittedSqlMigrations().slice(0, -1);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query(`
      CREATE TABLE stocket_committed_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const migration of migrations) {
      await pool.query('BEGIN');
      try {
        await pool.query(migration.sql);
        await pool.query(
          'INSERT INTO stocket_committed_migrations (name) VALUES ($1)',
          [migration.name],
        );
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
    await pool.query(`
      INSERT INTO roles (name, description, is_system)
      VALUES ('Legacy role', 'Upgrade sentinel', false)
    `);
  } finally {
    await pool.end();
  }
};

describe('pre-deploy migration command', () => {
  it(
    'serializes concurrent fresh installs and records readiness once',
    async () => {
      const database = await createTemporaryDatabase();
      try {
        const results = await Promise.all([
          runMigrationCommand(database.url),
          runMigrationCommand(database.url),
        ]);
        results.forEach(expectSuccessfulCommand);

        const migrations = getCommittedSqlMigrations();
        const pool = new pg.Pool({ connectionString: database.url });
        try {
          const version = await pool.query(
            'SELECT version FROM stocket_schema_version WHERE singleton = true',
          );
          expect(version.rows).toEqual([
            { version: migrations.at(-1)?.name },
          ]);

          const migrationCount = await pool.query(
            'SELECT count(*)::int AS count FROM stocket_committed_migrations',
          );
          expect(migrationCount.rows).toEqual([{ count: migrations.length }]);

          const dataMigrationCount = await pool.query(
            'SELECT count(*)::int AS count FROM stocket_data_migrations',
          );
          expect(dataMigrationCount.rows).toEqual([{ count: 2 }]);

          const superadminCount = await pool.query(
            'SELECT count(*)::int AS count FROM super_admins',
          );
          expect(superadminCount.rows).toEqual([{ count: 1 }]);

          const systemRoleCount = await pool.query(
            'SELECT count(*)::int AS count FROM roles WHERE is_system = true',
          );
          expect(systemRoleCount.rows[0]?.count).toBeGreaterThan(0);
        } finally {
          await pool.end();
        }
      } finally {
        await dropTemporaryDatabase(database.name);
      }
    },
    90_000,
  );

  it(
    'upgrades the previous production bookkeeping shape without data loss',
    async () => {
      const database = await createTemporaryDatabase();
      try {
        await preparePreviousProductionSchema(database.url);
        const result = await runMigrationCommand(database.url);
        expectSuccessfulCommand(result);

        const migrations = getCommittedSqlMigrations();
        const pool = new pg.Pool({ connectionString: database.url });
        try {
          const applied = await pool.query(`
            SELECT name, supports_previous_application_version
            FROM stocket_committed_migrations
            ORDER BY name
          `);
          expect(applied.rows).toEqual(
            migrations.map((migration) => ({
              name: migration.name,
              supports_previous_application_version:
                migration.supportsPreviousApplicationVersion,
            })),
          );

          const version = await pool.query(
            'SELECT version FROM stocket_schema_version WHERE singleton = true',
          );
          expect(version.rows).toEqual([
            { version: migrations.at(-1)?.name },
          ]);

          const legacyRole = await pool.query(
            "SELECT name FROM roles WHERE name = 'Legacy role'",
          );
          expect(legacyRole.rows).toEqual([{ name: 'Legacy role' }]);
        } finally {
          await pool.end();
        }
      } finally {
        await dropTemporaryDatabase(database.name);
      }
    },
    90_000,
  );
});
