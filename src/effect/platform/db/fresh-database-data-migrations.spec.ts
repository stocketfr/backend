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

  it('seeds when an existing database has no data-migration marker table yet', async () => {
    const db = makeDb([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    await runFreshDatabaseDataMigrations(db, { freshSchemaCreated: false });

    expect(seedSuperAdminMock).toHaveBeenCalledTimes(2);
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
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    await runFreshDatabaseDataMigrations(db, { freshSchemaCreated: true });

    expect(seedSuperAdminMock).toHaveBeenCalledTimes(2);
  });

  it('retries a pending first-database data migration on later startups', async () => {
    const db = makeDb([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    await runFreshDatabaseDataMigrations(db, { freshSchemaCreated: false });

    expect(seedSuperAdminMock).toHaveBeenCalledTimes(2);
  });

  it('reconciles the password after the seed migration marker exists', async () => {
    const db = makeDb([
      { rows: [] },
      { rows: [{ name: '0000_seed_platform_superadmin' }] },
      { rows: [] },
      { rows: [] },
    ]);

    await runFreshDatabaseDataMigrations(db, { freshSchemaCreated: false });

    expect(seedSuperAdminMock).toHaveBeenCalledOnce();
  });

  it('skips the superadmin seed after all data migration markers exist', async () => {
    const db = makeDb([
      { rows: [] },
      { rows: [{ name: '0000_seed_platform_superadmin' }] },
      { rows: [{ name: '0001_reconcile_platform_superadmin_password' }] },
    ]);

    await runFreshDatabaseDataMigrations(db, { freshSchemaCreated: false });

    expect(seedSuperAdminMock).not.toHaveBeenCalled();
  });
});
