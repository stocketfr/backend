import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { sql, type SQL } from 'drizzle-orm';
import { Schema } from 'effect';
import type { DrizzleDb } from './drizzle';
import { executeRows } from './execute-rows';

export interface CommittedSqlMigration {
  readonly name: string;
  readonly sql: string;
  readonly supportsPreviousApplicationVersion: boolean;
}

export interface AppliedCommittedSqlMigration {
  readonly name: string;
  readonly supports_previous_application_version: boolean;
}

export interface ApplyCommittedSqlMigrationsResult {
  readonly freshSchemaCreated: boolean;
}

type SqlExecutor = {
  readonly execute: (query: SQL) => Promise<unknown>;
};

type SqlResult = {
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
};

const MIGRATIONS_TABLE_NAME = 'stocket_committed_migrations';
const COMPATIBILITY_DIRECTIVE =
  /^-- stocket:previous-app-compatible=(true|false)$/;
const BASELINE_SCHEMA_MIGRATION = '0000_initial_schema.sql';
const EXISTING_SCHEMA_BASELINE_MIGRATIONS = new Set([
  BASELINE_SCHEMA_MIGRATION,
]);
const MIGRATIONS_INCLUDED_IN_FRESH_BASELINE = new Set([
  '0001_better_auth_user_ids_text.sql',
  '0002_reference_table_tenant_indexes.sql',
  '0003_notifications.sql',
  '0004_better_auth_user_ids_text_repair.sql',
  '0005_better_auth_user_ids_text_repair_rerun.sql',
]);

const AppliedCommittedSqlMigrationRow = Schema.Struct({
  name: Schema.String,
  supports_previous_application_version: Schema.Boolean,
});

const readCompatibilityDirective = (
  migrationName: string,
  migrationSql: string,
): boolean => {
  const firstLine = migrationSql.split(/\r?\n/, 1)[0] ?? '';
  const match = COMPATIBILITY_DIRECTIVE.exec(firstLine);
  if (!match) {
    throw new Error(
      `${migrationName} must start with -- stocket:previous-app-compatible=true or false`,
    );
  }

  return match[1] === 'true';
};

export const getCommittedSqlMigrations = (
  migrationsDir = path.resolve(process.cwd(), 'drizzle'),
): ReadonlyArray<CommittedSqlMigration> => {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  return readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => {
      const migrationSql = readFileSync(
        path.join(migrationsDir, fileName),
        'utf8',
      );
      return {
        name: fileName,
        sql: migrationSql,
        supportsPreviousApplicationVersion: readCompatibilityDirective(
          fileName,
          migrationSql,
        ),
      };
    });
};

async function executeSql(
  executor: SqlExecutor,
  query: SQL | string,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const result = (await executor.execute(
    typeof query === 'string' ? sql.raw(query) : query,
  )) as SqlResult;

  return Array.isArray(result.rows) ? result.rows : [];
}

async function tableExists(
  executor: SqlExecutor,
  tableName: string,
): Promise<boolean> {
  const rows = await executeSql(
    executor,
    sql.raw(
      `SELECT to_regclass('public.${tableName}') IS NOT NULL AS table_exists`,
    ),
  );

  return rows[0]?.table_exists === true;
}

async function ensureMigrationsTable(executor: SqlExecutor): Promise<void> {
  await executeSql(
    executor,
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE_NAME} (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      supports_previous_application_version boolean NOT NULL DEFAULT false
    )`,
  );
  await executeSql(
    executor,
    `ALTER TABLE ${MIGRATIONS_TABLE_NAME}
      ADD COLUMN IF NOT EXISTS supports_previous_application_version boolean NOT NULL DEFAULT false`,
  );
}

export async function getAppliedCommittedSqlMigrations(
  executor: SqlExecutor,
): Promise<ReadonlyArray<AppliedCommittedSqlMigration>> {
  return executeRows(
    executor,
    sql.raw(
      `SELECT name, supports_previous_application_version
       FROM ${MIGRATIONS_TABLE_NAME}
       ORDER BY name`,
    ),
    AppliedCommittedSqlMigrationRow,
  );
}

async function markMigrationApplied(
  executor: SqlExecutor,
  migration: CommittedSqlMigration,
): Promise<void> {
  await executeSql(
    executor,
    sql`
      INSERT INTO stocket_committed_migrations (
        name,
        supports_previous_application_version
      )
      VALUES (
        ${migration.name},
        ${migration.supportsPreviousApplicationVersion}
      )
      ON CONFLICT (name) DO UPDATE SET
        supports_previous_application_version = EXCLUDED.supports_previous_application_version
    `,
  );
}

export async function applyCommittedSqlMigrations(
  db: DrizzleDb,
  migrationsDir?: string,
): Promise<ApplyCommittedSqlMigrationsResult> {
  const migrations = getCommittedSqlMigrations(migrationsDir);

  await ensureMigrationsTable(db);

  const initiallyAppliedMigrationNames = new Set(
    (await getAppliedCommittedSqlMigrations(db)).map(({ name }) => name),
  );
  for (const migration of migrations) {
    if (initiallyAppliedMigrationNames.has(migration.name)) {
      await markMigrationApplied(db, migration);
    }
  }

  // Existing deployments had schema created before migration bookkeeping existed.
  // Treat the generated baseline as already applied, then run later idempotent SQL.
  const schemaAlreadyExists = await tableExists(db, 'roles');
  if (schemaAlreadyExists) {
    for (const migration of migrations) {
      if (EXISTING_SCHEMA_BASELINE_MIGRATIONS.has(migration.name)) {
        await markMigrationApplied(db, migration);
      }
    }
  }

  const appliedMigrationNames = new Set(
    (await getAppliedCommittedSqlMigrations(db)).map(({ name }) => name),
  );
  let freshBaselineApplied = false;

  for (const migration of migrations) {
    if (appliedMigrationNames.has(migration.name)) {
      continue;
    }

    await db.transaction(async (tx) => {
      await executeSql(tx, migration.sql);
      await markMigrationApplied(tx, migration);

      if (
        !schemaAlreadyExists &&
        migration.name === BASELINE_SCHEMA_MIGRATION
      ) {
        freshBaselineApplied = true;
        for (const includedMigration of migrations) {
          if (
            MIGRATIONS_INCLUDED_IN_FRESH_BASELINE.has(includedMigration.name)
          ) {
            await markMigrationApplied(tx, includedMigration);
            appliedMigrationNames.add(includedMigration.name);
          }
        }
      }
    });

    appliedMigrationNames.add(migration.name);
  }

  return {
    freshSchemaCreated: freshBaselineApplied,
  };
}
