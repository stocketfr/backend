import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getCommittedSqlMigrations,
  type AppliedCommittedSqlMigration,
} from './committed-sql-migrations';
import { assessSchemaCompatibility } from './schema-version';

const expectedMigrations = [
  { name: '0001_first.sql' },
  { name: '0002_second.sql' },
];

const applied = (
  name: string,
  supportsPreviousApplicationVersion = true,
): AppliedCommittedSqlMigration => ({
  name,
  supports_previous_application_version:
    supportsPreviousApplicationVersion,
});

describe('assessSchemaCompatibility', () => {
  it('accepts the schema prepared for this image', () => {
    expect(
      assessSchemaCompatibility(
        expectedMigrations,
        [applied('0001_first.sql'), applied('0002_second.sql')],
        '0002_second.sql',
      ),
    ).toEqual({
      compatible: true,
      expectedVersion: '0002_second.sql',
      actualVersion: '0002_second.sql',
    });
  });

  it('rejects an uninitialized database', () => {
    expect(
      assessSchemaCompatibility(expectedMigrations, [], undefined),
    ).toMatchObject({
      compatible: false,
      actualVersion: 'uninitialized',
      reason: 'uninitialized',
    });
  });

  it('rejects a database missing any migration embedded in the image', () => {
    expect(
      assessSchemaCompatibility(
        expectedMigrations,
        [applied('0001_first.sql')],
        '0001_first.sql',
      ),
    ).toMatchObject({
      compatible: false,
      reason: 'missing-migrations',
    });
  });

  it('rejects a stale marker after this image SQL was applied', () => {
    expect(
      assessSchemaCompatibility(
        expectedMigrations,
        [applied('0001_first.sql'), applied('0002_second.sql')],
        '0001_first.sql',
      ),
    ).toMatchObject({
      compatible: false,
      reason: 'predeploy-incomplete',
    });
  });

  it('allows an older image when every later migration is compatible', () => {
    expect(
      assessSchemaCompatibility(
        expectedMigrations,
        [
          applied('0001_first.sql'),
          applied('0002_second.sql'),
          applied('0003_additive.sql'),
        ],
        '0003_additive.sql',
      ),
    ).toMatchObject({ compatible: true });
  });

  it('allows the old marker during a partial compatible migration', () => {
    expect(
      assessSchemaCompatibility(
        expectedMigrations,
        [
          applied('0001_first.sql'),
          applied('0002_second.sql'),
          applied('0003_additive.sql'),
        ],
        '0002_second.sql',
      ),
    ).toMatchObject({ compatible: true });
  });

  it('rejects the old image as soon as an incompatible migration is applied', () => {
    expect(
      assessSchemaCompatibility(
        expectedMigrations,
        [
          applied('0001_first.sql'),
          applied('0002_second.sql'),
          applied('0003_breaking.sql', false),
        ],
        '0002_second.sql',
      ),
    ).toMatchObject({
      compatible: false,
      reason: 'ahead-incompatible',
    });
  });
});

describe('committed migration compatibility metadata', () => {
  it('is declared by every committed migration', () => {
    const migrations = getCommittedSqlMigrations();

    expect(migrations.length).toBeGreaterThan(0);
    expect(
      migrations.every(
        ({ supportsPreviousApplicationVersion }) =>
          typeof supportsPreviousApplicationVersion === 'boolean',
      ),
    ).toBe(true);
  });

  it('rejects a migration without a first-line directive', () => {
    const migrationsDir = mkdtempSync(
      path.join(tmpdir(), 'stocket-migrations-'),
    );
    try {
      writeFileSync(
        path.join(migrationsDir, '0001_missing_directive.sql'),
        'SELECT 1;\n',
      );

      expect(() => getCommittedSqlMigrations(migrationsDir)).toThrow(
        'must start with -- stocket:previous-app-compatible=true or false',
      );
    } finally {
      rmSync(migrationsDir, { recursive: true, force: true });
    }
  });
});
