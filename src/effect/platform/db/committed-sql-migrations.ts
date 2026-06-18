import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { sql, type SQL } from 'drizzle-orm';
import type { DrizzleDb } from './drizzle';

export interface CommittedSqlMigration {
  readonly name: string;
  readonly sql: string;
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

export const getCommittedSqlMigrations = (
  migrationsDir = path.resolve(process.cwd(), 'drizzle'),
): ReadonlyArray<CommittedSqlMigration> => {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  return readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => ({
      name: fileName,
      sql: readFileSync(path.join(migrationsDir, fileName), 'utf8'),
    }));
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
      applied_at timestamptz NOT NULL DEFAULT now()
    )`,
  );
}

async function getAppliedMigrationNames(
  executor: SqlExecutor,
): Promise<ReadonlySet<string>> {
  const rows = await executeSql(
    executor,
    `SELECT name FROM ${MIGRATIONS_TABLE_NAME} ORDER BY name`,
  );

  return new Set(rows.map((row) => String(row.name)));
}

async function markMigrationApplied(
  executor: SqlExecutor,
  migrationName: string,
): Promise<void> {
  await executeSql(
    executor,
    sql`
      INSERT INTO stocket_committed_migrations (name)
      VALUES (${migrationName})
      ON CONFLICT (name) DO NOTHING
    `,
  );
}

export async function applyCommittedSqlMigrations(
  db: DrizzleDb,
  migrationsDir?: string,
): Promise<ApplyCommittedSqlMigrationsResult> {
  const migrations = getCommittedSqlMigrations(migrationsDir);

  await ensureMigrationsTable(db);

  // Existing deployments had schema created before migration bookkeeping existed.
  // Treat the generated baseline as already applied, then run later idempotent SQL.
  const schemaAlreadyExists = await tableExists(db, 'roles');
  if (schemaAlreadyExists) {
    for (const migration of migrations) {
      if (EXISTING_SCHEMA_BASELINE_MIGRATIONS.has(migration.name)) {
        await markMigrationApplied(db, migration.name);
      }
    }
  }

  const appliedMigrationNames = new Set(await getAppliedMigrationNames(db));
  let freshBaselineApplied = false;

  for (const migration of migrations) {
    if (appliedMigrationNames.has(migration.name)) {
      continue;
    }

    await db.transaction(async (tx) => {
      await executeSql(tx, migration.sql);
      await markMigrationApplied(tx, migration.name);

      if (
        !schemaAlreadyExists &&
        migration.name === BASELINE_SCHEMA_MIGRATION
      ) {
        freshBaselineApplied = true;
        for (const includedMigration of migrations) {
          if (
            MIGRATIONS_INCLUDED_IN_FRESH_BASELINE.has(includedMigration.name)
          ) {
            await markMigrationApplied(tx, includedMigration.name);
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
