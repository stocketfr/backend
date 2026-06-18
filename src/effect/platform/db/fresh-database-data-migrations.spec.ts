import { seedSuperAdmin } from '../../../scripts/seed-superadmin';
import type { DrizzleDb } from './drizzle';
import {
  prepareFreshDatabaseDataMigrations,
  runFreshDatabaseDataMigrations,
} from './fresh-database-data-migrations';

vi.mock('../../../scripts/seed-superadmin', () => ({
  seedSuperAdmin: vi.fn().mockResolvedValue(undefined),
}));

const seedSuperAdminMock = vi.mocked(seedSuperAdmin);

function makeDb(
  responses: ReadonlyArray<{ readonly rows?: ReadonlyArray<unknown> }>,
) {
  const queue = [...responses];
  return {
    execute: vi.fn(async () => queue.shift() ?? { rows: [] }),
  } as unknown as DrizzleDb;
}

describe('runFreshDatabaseDataMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips existing databases with no pending fresh-database data migrations', async () => {
    const db = makeDb([{ rows: [{ table_exists: false }] }]);

    await runFreshDatabaseDataMigrations(db, { freshSchemaCreated: false });

    expect(seedSuperAdminMock).not.toHaveBeenCalled();
  });

  it('prepares the marker table as soon as a fresh schema is created', async () => {
    const db = makeDb([{ rows: [] }]);

    await prepareFreshDatabaseDataMigrations(db, { freshSchemaCreated: true });

    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('does not prepare the marker table for an existing database', async () => {
    const db = makeDb([]);

    await prepareFreshDatabaseDataMigrations(db, { freshSchemaCreated: false });

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('seeds the platform superadmin for a freshly created schema', async () => {
    const db = makeDb([
      { rows: [{ table_exists: false }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    await runFreshDatabaseDataMigrations(db, { freshSchemaCreated: true });

    expect(seedSuperAdminMock).toHaveBeenCalledOnce();
  });

  it('retries a pending first-database data migration on later startups', async () => {
    const db = makeDb([
      { rows: [{ table_exists: true }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    await runFreshDatabaseDataMigrations(db, { freshSchemaCreated: false });

    expect(seedSuperAdminMock).toHaveBeenCalledOnce();
  });

  it('skips the superadmin seed after its data migration marker exists', async () => {
    const db = makeDb([
      { rows: [{ table_exists: true }] },
      { rows: [] },
      { rows: [{ name: '0000_seed_platform_superadmin' }] },
    ]);

    await runFreshDatabaseDataMigrations(db, { freshSchemaCreated: false });

    expect(seedSuperAdminMock).not.toHaveBeenCalled();
  });
});
