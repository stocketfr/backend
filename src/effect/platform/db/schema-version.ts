import { Effect, Layer, Schema } from 'effect';
import { sql } from 'drizzle-orm';
import {
  getAppliedCommittedSqlMigrations,
  getCommittedSqlMigrations,
  type AppliedCommittedSqlMigration,
  type CommittedSqlMigration,
} from './committed-sql-migrations';
import {
  DrizzleDatabase,
  DrizzleInitializationError,
  type DrizzleDb,
} from './drizzle';
import { executeRows } from './execute-rows';
import { InternalError } from '../effect/domain-errors';

const MigrationTableState = Schema.Struct({
  schema_version_table_exists: Schema.Boolean,
  migration_compatibility_column_exists: Schema.Boolean,
});

const CurrentSchemaVersionRow = Schema.Struct({
  version: Schema.String,
});

type ExpectedMigration = Pick<CommittedSqlMigration, 'name'>;

export type SchemaIncompatibilityReason =
  | 'uninitialized'
  | 'missing-migrations'
  | 'predeploy-incomplete'
  | 'ahead-incompatible'
  | 'invalid-version-marker';

export type SchemaCompatibility =
  | {
      readonly compatible: true;
      readonly expectedVersion: string;
      readonly actualVersion: string;
    }
  | {
      readonly compatible: false;
      readonly expectedVersion: string;
      readonly actualVersion: string;
      readonly reason: SchemaIncompatibilityReason;
    };

const isSchemaCompatible = (
  compatibility: SchemaCompatibility,
): compatibility is Extract<SchemaCompatibility, { readonly compatible: true }> =>
  compatibility.compatible;

export class SchemaVersionIncompatibleError extends InternalError(
  'SchemaVersionIncompatibleError',
)<{
  readonly expectedSchemaVersion: string;
  readonly actualSchemaVersion: string;
  readonly reason: SchemaIncompatibilityReason;
}> {}

const getExpectedVersion = (
  expectedMigrations: ReadonlyArray<ExpectedMigration>,
): string => {
  const expectedVersion = expectedMigrations.at(-1)?.name;
  if (!expectedVersion) {
    throw new Error('The application image contains no committed migrations');
  }
  return expectedVersion;
};

export const assessSchemaCompatibility = (
  expectedMigrations: ReadonlyArray<ExpectedMigration>,
  appliedMigrations: ReadonlyArray<AppliedCommittedSqlMigration>,
  currentVersion: string | undefined,
): SchemaCompatibility => {
  const expectedVersion = getExpectedVersion(expectedMigrations);
  if (!currentVersion) {
    return {
      compatible: false,
      expectedVersion,
      actualVersion: 'uninitialized',
      reason: 'uninitialized',
    };
  }

  const expectedNames = new Set(
    expectedMigrations.map((migration) => migration.name),
  );
  const appliedByName = new Map(
    appliedMigrations.map((migration) => [migration.name, migration]),
  );
  if (
    expectedMigrations.some((migration) => !appliedByName.has(migration.name))
  ) {
    return {
      compatible: false,
      expectedVersion,
      actualVersion: currentVersion,
      reason: 'missing-migrations',
    };
  }

  const appliedAfterImage = appliedMigrations.filter(
    (migration) => !expectedNames.has(migration.name),
  );
  if (
    appliedAfterImage.some(
      (migration) => !migration.supports_previous_application_version,
    )
  ) {
    return {
      compatible: false,
      expectedVersion,
      actualVersion: currentVersion,
      reason: 'ahead-incompatible',
    };
  }

  if (currentVersion === expectedVersion) {
    return {
      compatible: true,
      expectedVersion,
      actualVersion: currentVersion,
    };
  }

  if (expectedNames.has(currentVersion)) {
    return {
      compatible: false,
      expectedVersion,
      actualVersion: currentVersion,
      reason: 'predeploy-incomplete',
    };
  }

  if (!appliedByName.has(currentVersion)) {
    return {
      compatible: false,
      expectedVersion,
      actualVersion: currentVersion,
      reason: 'invalid-version-marker',
    };
  }

  return {
    compatible: true,
    expectedVersion,
    actualVersion: currentVersion,
  };
};

export async function inspectSchemaCompatibility(
  db: DrizzleDb,
  expectedMigrations = getCommittedSqlMigrations(),
): Promise<SchemaCompatibility> {
  const tableStates = await executeRows(
    db,
    sql`
      SELECT
        to_regclass('public.stocket_schema_version') IS NOT NULL
          AS schema_version_table_exists,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'stocket_committed_migrations'
            AND column_name = 'supports_previous_application_version'
        ) AS migration_compatibility_column_exists
    `,
    MigrationTableState,
  );
  const tableState = tableStates[0];
  if (
    !tableState?.schema_version_table_exists ||
    !tableState.migration_compatibility_column_exists
  ) {
    return assessSchemaCompatibility(expectedMigrations, [], undefined);
  }

  const versionRows = await executeRows(
    db,
    sql`
      SELECT version
      FROM stocket_schema_version
      WHERE singleton = true
      LIMIT 1
    `,
    CurrentSchemaVersionRow,
  );
  const appliedMigrations = await getAppliedCommittedSqlMigrations(db);
  return assessSchemaCompatibility(
    expectedMigrations,
    appliedMigrations,
    versionRows[0]?.version,
  );
}

export async function recordCurrentSchemaVersion(
  db: DrizzleDb,
  expectedMigrations = getCommittedSqlMigrations(),
): Promise<void> {
  const expectedVersion = getExpectedVersion(expectedMigrations);
  const appliedMigrationNames = new Set(
    (await getAppliedCommittedSqlMigrations(db)).map(({ name }) => name),
  );
  if (
    expectedMigrations.some(
      (migration) => !appliedMigrationNames.has(migration.name),
    )
  ) {
    throw new Error(
      'Cannot record the schema version before all committed migrations are applied',
    );
  }

  await db.execute(sql`
    INSERT INTO stocket_schema_version (singleton, version, updated_at)
    VALUES (true, ${expectedVersion}, now())
    ON CONFLICT (singleton) DO UPDATE SET
      version = EXCLUDED.version,
      updated_at = EXCLUDED.updated_at
  `);
}

const checkSchemaCompatibility = Effect.gen(function* () {
  const db = yield* DrizzleDatabase;
  const compatibility = yield* Effect.tryPromise({
    try: () => inspectSchemaCompatibility(db),
    catch: (cause) =>
      new DrizzleInitializationError({
        cause,
        messageKey: 'drizzle.schemaCheckFailed',
      }),
  });

  yield* Effect.filterOrFail(
    Effect.succeed(compatibility),
    isSchemaCompatible,
    (incompatible) =>
      new SchemaVersionIncompatibleError({
        expectedSchemaVersion: incompatible.expectedVersion,
        actualSchemaVersion: incompatible.actualVersion,
        reason: incompatible.reason,
        messageKey: 'drizzle.schemaIncompatible',
        messageArgs: {
          expectedSchemaVersion: incompatible.expectedVersion,
          actualSchemaVersion: incompatible.actualVersion,
        },
      }),
  );
});

export const schemaCompatibilityLayer = Layer.scopedDiscard(
  checkSchemaCompatibility,
);
