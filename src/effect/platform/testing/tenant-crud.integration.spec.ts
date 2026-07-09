import { Effect, Layer } from 'effect';
import { eq, ilike, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { categories, products, roles, suppliers } from '../db/schema';
import { DrizzleDatabase } from '../db/drizzle';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../http/request-context';
import { TenantQuery } from '../tenancy/tenant-query';
import { makeTenantCrud, type TenantCrudUpdatePatch } from '../db/tenant-crud';
import { SuppliersInfrastructureError } from '../../modules/suppliers/suppliers.errors';
import {
  getTestDb,
  makeTestRequestContext,
  withTestDb,
} from '../../testing/test-harness';

withTestDb();

const TENANT_A = '00000000-0000-4000-8000-000000000301';
const TENANT_B = '00000000-0000-4000-8000-000000000302';

interface ProbeQuery {
  readonly page?: number;
  readonly limit?: number;
  readonly q?: string;
}

/** Probe over the real suppliers table — the factory interface is the test surface. */
const makeProbe = () =>
  makeTenantCrud(suppliers, {
    entity: 'supplier',
    onError: (action, cause) =>
      new SuppliersInfrastructureError({
        action,
        cause,
        messageKey: 'suppliers.repositoryFailed',
      }),
    list: {
      filters: (query: ProbeQuery) =>
        query.q ? [ilike(suppliers.name, `%${query.q}%`)] : [],
      orderBy: sql`"name" ASC`,
    },
    extras: ({ db, withTransaction }) => ({
      createThenFail: (tenantId: string) =>
        withTransaction('create supplier then fail', async (tx) => {
          await tx.insert(suppliers).values({
            tenant_id: tenantId,
            name: 'Rolled Back Supplier',
          });
          throw new Error('rollback supplier transaction');
        }),
      createOutsideTransaction: (tenantId: string, name: string) =>
        Effect.promise(() =>
          db.insert(suppliers).values({ tenant_id: tenantId, name }),
        ),
    }),
  });

type Probe = Effect.Effect.Success<ReturnType<typeof makeProbe>>;

class TenantCrudUniqueProbeError extends Error {
  readonly _tag = 'TenantCrudUniqueProbeError' as const;
}

const makeRoleProbe = () =>
  makeTenantCrud(roles, {
    entity: 'role',
    onError: (
      action,
      cause,
    ): SuppliersInfrastructureError | TenantCrudUniqueProbeError =>
      new SuppliersInfrastructureError({
        action,
        cause,
        messageKey: 'suppliers.repositoryFailed',
      }),
    uniqueViolations: {
      roles_tenant_name_unique: () => new TenantCrudUniqueProbeError(),
    },
  });

type RoleProbe = Effect.Effect.Success<ReturnType<typeof makeRoleProbe>>;

interface ProductProbeQuery {
  readonly page?: number;
  readonly limit?: number;
  readonly includeDeleted?: boolean;
}

const makeProductProbe = () =>
  makeTenantCrud(products, {
    entity: 'product',
    onError: (action, cause) =>
      new SuppliersInfrastructureError({
        action,
        cause,
        messageKey: 'suppliers.repositoryFailed',
      }),
    softDelete: {
      deletedAt: products.deleted_at,
      deletedBy: products.deleted_by,
    },
    list: {
      filters: () => [],
      includeDeleted: (query: ProductProbeQuery) =>
        query.includeDeleted === true,
      orderBy: sql`"sku" ASC`,
    },
  });

type ProductProbe = Effect.Effect.Success<ReturnType<typeof makeProductProbe>>;

const makeTenantContext = (tenantId: string): RequestContext => ({
  ...makeTestRequestContext(),
  tenantId,
  tenantName: tenantId,
  tenantSlug: tenantId,
});

const asTenant = (tenantId: string) =>
  Layer.mergeAll(
    TenantQuery.Default,
    Layer.sync(DrizzleDatabase, () => getTestDb()),
    Layer.succeed(CurrentRequestContext, makeTenantContext(tenantId)),
  );

const run = <A, E>(
  tenantId: string,
  use: (crud: Probe) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    makeProbe().pipe(Effect.flatMap(use), Effect.provide(asTenant(tenantId))),
  );

const runFail = <A, E>(
  tenantId: string,
  use: (crud: Probe) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.flip(
      makeProbe().pipe(Effect.flatMap(use), Effect.provide(asTenant(tenantId))),
    ),
  );

const runRole = <A, E>(
  tenantId: string,
  use: (crud: RoleProbe) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    makeRoleProbe().pipe(
      Effect.flatMap(use),
      Effect.provide(asTenant(tenantId)),
    ),
  );

const runRoleFail = <A, E>(
  tenantId: string,
  use: (crud: RoleProbe) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.flip(
      makeRoleProbe().pipe(
        Effect.flatMap(use),
        Effect.provide(asTenant(tenantId)),
      ),
    ),
  );

const runProduct = <A, E>(
  tenantId: string,
  use: (crud: ProductProbe) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    makeProductProbe().pipe(
      Effect.flatMap(use),
      Effect.provide(asTenant(tenantId)),
    ),
  );

const seedSuppliers = async (tenantId: string, names: string[]) => {
  const db = getTestDb();
  const rows = await db
    .insert(suppliers)
    .values(names.map((name) => ({ tenant_id: tenantId, name })))
    .returning();
  return rows;
};

const seedCategory = async (tenantId: string) => {
  const [category] = await getTestDb()
    .insert(categories)
    .values({ tenant_id: tenantId, name: `Category ${tenantId.slice(-3)}` })
    .returning();
  return category!;
};

const seedProduct = async (
  tenantId: string,
  categoryId: string,
  sku: string,
  deleted = false,
) => {
  const [product] = await getTestDb()
    .insert(products)
    .values({
      tenant_id: tenantId,
      category_id: categoryId,
      sku,
      name: sku,
      deleted_at: deleted ? new Date('2026-01-01T00:00:00.000Z') : null,
    })
    .returning();
  return product!;
};

describe('makeTenantCrud', () => {
  describe('tenant isolation', () => {
    let foreignId: string;

    beforeEach(async () => {
      await seedSuppliers(TENANT_A, ['Alpha']);
      const [foreign] = await seedSuppliers(TENANT_B, ['Beta']);
      foreignId = foreign!.id;
    });

    it('findById cannot see another tenant’s row', async () => {
      const row = await run(TENANT_A, (crud) => crud.findById(foreignId));
      expect(row).toBeNull();
    });

    it('existsById is false for another tenant’s row', async () => {
      const exists = await run(TENANT_A, (crud) => crud.existsById(foreignId));
      expect(exists).toBe(false);
    });

    it('update on another tenant’s row returns null and changes nothing', async () => {
      const result = await run(TENANT_A, (crud) =>
        crud.update(foreignId, { name: 'Leaked Update' }),
      );
      expect(result).toBeNull();

      const unchanged = await getTestDb().query.suppliers.findFirst({
        where: eq(suppliers.id, foreignId),
      });
      expect(unchanged!.name).toBe('Beta');
    });

    it('delete on another tenant’s row is a no-op', async () => {
      await run(TENANT_A, (crud) => crud.delete(foreignId));

      const remaining = await getTestDb().query.suppliers.findFirst({
        where: eq(suppliers.id, foreignId),
      });
      expect(remaining).toBeTruthy();
    });

    it('findAllPaginated only lists the request tenant’s rows', async () => {
      const result = await run(TENANT_A, (crud) => crud.findAllPaginated({}));
      expect(result.total).toBe(1);
      expect(result.data.map((row) => row.name)).toEqual(['Alpha']);
    });
  });

  describe('create', () => {
    it('stamps the request tenant and returns the full row', async () => {
      const created = await run(TENANT_A, (crud) =>
        crud.create({ name: 'Created' }),
      );

      expect(created.id).toBeTruthy();
      expect(created.tenant_id).toBe(TENANT_A);
      expect(created.name).toBe('Created');
      expect(created.is_active).toBe(true);
    });
  });

  describe('update', () => {
    it('returns the full updated row', async () => {
      const [seeded] = await seedSuppliers(TENANT_A, ['Original']);

      const updated = await run(TENANT_A, (crud) =>
        crud.update(seeded!.id, { name: 'Renamed', notes: 'touched' }),
      );

      expect(updated).toMatchObject({
        id: seeded!.id,
        name: 'Renamed',
        notes: 'touched',
        tenant_id: TENANT_A,
      });
      expect(updated!.created_at.getTime()).toBe(seeded!.created_at.getTime());
    });

    it('strips immutable columns smuggled past the types', async () => {
      const [seeded] = await seedSuppliers(TENANT_A, ['Original']);

      // Simulates a hostile payload; the type system forbids these keys.
      const hostile = {
        name: 'Renamed',
        tenant_id: TENANT_B,
        id: '00000000-0000-4000-8000-00000000dead',
      } as TenantCrudUpdatePatch<typeof suppliers>;

      const updated = await run(TENANT_A, (crud) =>
        crud.update(seeded!.id, hostile),
      );

      expect(updated).toMatchObject({
        id: seeded!.id,
        name: 'Renamed',
        tenant_id: TENANT_A,
      });
    });

    it('accepts an empty patch', async () => {
      const [seeded] = await seedSuppliers(TENANT_A, ['Original']);

      const updated = await run(TENANT_A, (crud) =>
        crud.update(seeded!.id, {}),
      );

      expect(updated).toMatchObject({ id: seeded!.id, name: 'Original' });
    });

    it('returns null for a missing id', async () => {
      const updated = await run(TENANT_A, (crud) =>
        crud.update('00000000-0000-4000-8000-00000000beef', { name: 'X' }),
      );
      expect(updated).toBeNull();
    });
  });

  describe('bulk primitives', () => {
    it('findByIds and updateMany are tenant-scoped and return exact ids', async () => {
      const [first, second] = await seedSuppliers(TENANT_A, [
        'Bulk One',
        'Bulk Two',
      ]);
      const [foreign] = await seedSuppliers(TENANT_B, ['Bulk Other']);

      const found = await run(TENANT_A, (crud) =>
        crud.findByIds([first!.id, second!.id, foreign!.id]),
      );
      expect(found.map((row) => row.id).sort()).toEqual(
        [first!.id, second!.id].sort(),
      );

      const updatedIds = await run(TENANT_A, (crud) =>
        crud.updateMany([first!.id, foreign!.id], { notes: 'bulk touched' }),
      );
      expect(updatedIds).toEqual([first!.id]);

      const foreignAfter = await getTestDb().query.suppliers.findFirst({
        where: eq(suppliers.id, foreign!.id),
      });
      expect(foreignAfter!.notes).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the row and is idempotent', async () => {
      const [seeded] = await seedSuppliers(TENANT_A, ['Doomed']);

      await run(TENANT_A, (crud) => crud.delete(seeded!.id));
      await run(TENANT_A, (crud) => crud.delete(seeded!.id));

      const remaining = await getTestDb().query.suppliers.findFirst({
        where: eq(suppliers.id, seeded!.id),
      });
      expect(remaining).toBeFalsy();
    });
  });

  describe('transaction extras', () => {
    it('rolls back work through withTransaction', async () => {
      const error = await runFail(TENANT_A, (crud) =>
        crud.createThenFail(TENANT_A),
      );

      expect(error).toBeInstanceOf(SuppliersInfrastructureError);

      const rows = await getTestDb()
        .select()
        .from(suppliers)
        .where(eq(suppliers.name, 'Rolled Back Supplier'));
      expect(rows).toHaveLength(0);
    });
  });

  describe('unique violation mapping', () => {
    it('maps configured pg unique violations before generic infrastructure errors', async () => {
      await runRole(TENANT_A, (crud) =>
        crud.create({ name: 'Tenant Admin', is_system: true }),
      );

      const error = await runRoleFail(TENANT_A, (crud) =>
        crud.create({ name: 'Tenant Admin', is_system: false }),
      );

      expect(error).toBeInstanceOf(TenantCrudUniqueProbeError);
    });
  });

  describe('soft delete', () => {
    it('excludes deleted rows by default and can include them per read', async () => {
      const category = await seedCategory(TENANT_A);
      const active = await seedProduct(TENANT_A, category.id, 'ACTIVE-001');
      const deleted = await seedProduct(
        TENANT_A,
        category.id,
        'DELETED-001',
        true,
      );

      await expect(
        runProduct(TENANT_A, (crud) => crud.findById(active.id)),
      ).resolves.toMatchObject({ id: active.id });
      await expect(
        runProduct(TENANT_A, (crud) => crud.findById(deleted.id)),
      ).resolves.toBeNull();
      await expect(
        runProduct(TENANT_A, (crud) =>
          crud.findById(deleted.id, { includeDeleted: true }),
        ),
      ).resolves.toMatchObject({ id: deleted.id });

      const listed = await runProduct(TENANT_A, (crud) =>
        crud.findAllPaginated({}),
      );
      expect(listed.data.map((row) => row.id)).toEqual([active.id]);

      const listedWithDeleted = await runProduct(TENANT_A, (crud) =>
        crud.findAllPaginated({ includeDeleted: true }),
      );
      expect(listedWithDeleted.data.map((row) => row.id).sort()).toEqual(
        [active.id, deleted.id].sort(),
      );
    });

    it('soft-deletes, restores, and hard-deletes exact ids', async () => {
      const category = await seedCategory(TENANT_A);
      const first = await seedProduct(TENANT_A, category.id, 'SOFT-001');
      const second = await seedProduct(TENANT_A, category.id, 'SOFT-002');

      const softDeletedIds = await runProduct(TENANT_A, (crud) =>
        crud.softDeleteMany([first.id, second.id], 'user-1'),
      );
      expect(softDeletedIds.sort()).toEqual([first.id, second.id].sort());

      const deletedRows = await runProduct(TENANT_A, (crud) =>
        crud.findDeletedByIds([first.id, second.id]),
      );
      expect(deletedRows.map((row) => row.deleted_by)).toEqual([
        'user-1',
        'user-1',
      ]);

      const restoredIds = await runProduct(TENANT_A, (crud) =>
        crud.restoreMany([first.id, second.id]),
      );
      expect(restoredIds.sort()).toEqual([first.id, second.id].sort());

      const hardDeletedIds = await runProduct(TENANT_A, (crud) =>
        crud.hardDeleteMany([first.id, second.id]),
      );
      expect(hardDeletedIds.sort()).toEqual([first.id, second.id].sort());

      const rows = await getTestDb()
        .select()
        .from(products)
        .where(eq(products.category_id, category.id));
      expect(rows).toHaveLength(0);
    });
  });

  describe('findAllPaginated', () => {
    beforeEach(async () => {
      const names = Array.from(
        { length: 25 },
        (_, i) => `Item ${String(i + 1).padStart(2, '0')}`,
      );
      await seedSuppliers(TENANT_A, names);
      await seedSuppliers(TENANT_B, ['Other 1', 'Other 2']);
    });

    it('windows and orders within the tenant', async () => {
      const result = await run(TENANT_A, (crud) =>
        crud.findAllPaginated({ page: 2, limit: 10 }),
      );

      expect(result.total).toBe(25);
      expect(result.total_pages).toBe(3);
      expect(result.page).toBe(2);
      expect(result.data).toHaveLength(10);
      expect(result.data[0]!.name).toBe('Item 11');
    });

    it('defaults to page 1 / limit 20', async () => {
      const result = await run(TENANT_A, (crud) => crud.findAllPaginated({}));

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.data).toHaveLength(20);
    });

    it('returns empty data past the last page with correct totals', async () => {
      const result = await run(TENANT_A, (crud) =>
        crud.findAllPaginated({ page: 4, limit: 10 }),
      );

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(25);
      expect(result.total_pages).toBe(3);
    });

    it('applies the module filters', async () => {
      const result = await run(TENANT_A, (crud) =>
        crud.findAllPaginated({ q: 'Item 2' }),
      );

      expect(result.data.map((row) => row.name)).toEqual([
        'Item 20',
        'Item 21',
        'Item 22',
        'Item 23',
        'Item 24',
        'Item 25',
      ]);
    });
  });

  describe('error wrapping', () => {
    it('maps SQL failures through onError with the derived action', async () => {
      // `as never` smuggles an invalid payload past the types to force a
      // NOT NULL violation.
      const error = await runFail(TENANT_A, (crud) =>
        crud.create({ name: null } as never),
      );

      expect(error).toBeInstanceOf(SuppliersInfrastructureError);
      expect(error).toMatchObject({
        _tag: 'SuppliersInfrastructureError',
        action: 'create supplier',
      });
    });
  });
});
