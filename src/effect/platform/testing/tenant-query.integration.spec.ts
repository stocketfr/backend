import { Effect, Layer } from 'effect';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { categories } from '../db/schema';
import { CurrentRequestContext, type RequestContext } from '../http/request-context';
import { TenantQuery } from '../tenancy/tenant-query';
import {
  getTestDb,
  makeTestRequestContext,
  withTestDb,
} from '../../testing/test-harness';

withTestDb();

const TENANT_A = '00000000-0000-4000-8000-000000000201';
const TENANT_B = '00000000-0000-4000-8000-000000000202';

const makeTenantContext = (tenantId: string): RequestContext => ({
  ...makeTestRequestContext(),
  tenantId,
  tenantName: tenantId,
  tenantSlug: tenantId,
});

const run = <A, E>(
  tenantId: string,
  effect: Effect.Effect<A, E, TenantQuery>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          TenantQuery.Default,
          Layer.succeed(CurrentRequestContext, makeTenantContext(tenantId)),
        ),
      ),
    ),
  );

beforeEach(async () => {
  const db = getTestDb();
  await db.insert(categories).values([
    { tenant_id: TENANT_A, name: 'Tenant A Category' },
    { tenant_id: TENANT_B, name: 'Tenant B Category' },
  ]);
});

describe('TenantQuery', () => {
  it('builds tenant-scoped select predicates', async () => {
    const rows = await run(
      TENANT_A,
      Effect.gen(function* () {
        const tenantQuery = yield* TenantQuery;
        const where = yield* tenantQuery.whereTenant(categories);
        return yield* Effect.promise(() =>
          getTestDb()
            .select()
            .from(categories)
            .where(where)
            .orderBy(asc(categories.name)),
        );
      }),
    );

    expect(rows.map((row) => row.name)).toEqual(['Tenant A Category']);
  });

  it('injects the request tenant into insert values', async () => {
    const inserted = await run(
      TENANT_A,
      Effect.gen(function* () {
        const tenantQuery = yield* TenantQuery;
        const values = yield* tenantQuery.insertValues({ name: 'Inserted' });
        const rows = yield* Effect.promise(() =>
          getTestDb().insert(categories).values(values).returning(),
        );
        return rows[0]!;
      }),
    );

    expect(inserted.tenant_id).toBe(TENANT_A);
  });

  it('builds explicit tenant scopes without request context', async () => {
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const tenantQuery = yield* TenantQuery;
        const tenantScope = tenantQuery.forTenant(TENANT_B);
        const inserted = tenantScope.insertValues({
          name: 'Explicit Tenant Inserted',
        });

        yield* Effect.promise(() =>
          getTestDb().insert(categories).values(inserted),
        );

        return yield* Effect.promise(() =>
          getTestDb()
            .select()
            .from(categories)
            .where(tenantScope.whereTenant(categories))
            .orderBy(asc(categories.name)),
        );
      }).pipe(Effect.provide(TenantQuery.Default)),
    );

    expect(rows.map((row) => row.name)).toEqual([
      'Explicit Tenant Inserted',
      'Tenant B Category',
    ]);
  });

  it('scopes update predicates by tenant and id', async () => {
    const tenantBRow = await getTestDb().query.categories.findFirst({
      where: eq(categories.tenant_id, TENANT_B),
    });

    const affected = await run(
      TENANT_A,
      Effect.gen(function* () {
        const tenantQuery = yield* TenantQuery;
        const where = yield* tenantQuery.whereTenantId(
          categories,
          tenantBRow!.id,
        );
        const rows = yield* Effect.promise(() =>
          getTestDb()
            .update(categories)
            .set({ name: 'Leaked Update' })
            .where(where)
            .returning({ id: categories.id }),
        );
        return rows.length;
      }),
    );

    const unchanged = await getTestDb().query.categories.findFirst({
      where: eq(categories.id, tenantBRow!.id),
    });

    expect(affected).toBe(0);
    expect(unchanged!.name).toBe('Tenant B Category');
  });

  it('scopes id-list predicates by tenant', async () => {
    const tenantARow = await getTestDb().query.categories.findFirst({
      where: eq(categories.tenant_id, TENANT_A),
    });
    const tenantBRow = await getTestDb().query.categories.findFirst({
      where: eq(categories.tenant_id, TENANT_B),
    });

    const rows = await run(
      TENANT_A,
      Effect.gen(function* () {
        const tenantQuery = yield* TenantQuery;
        const where = yield* tenantQuery.whereTenantIds(categories, [
          tenantARow!.id,
          tenantBRow!.id,
        ]);
        return yield* Effect.promise(() =>
          getTestDb()
            .select()
            .from(categories)
            .where(where)
            .orderBy(asc(categories.name)),
        );
      }),
    );

    expect(rows.map((row) => row.name)).toEqual(['Tenant A Category']);
  });

  it('scopes delete predicates by tenant and id', async () => {
    const tenantBRow = await getTestDb().query.categories.findFirst({
      where: eq(categories.tenant_id, TENANT_B),
    });

    await run(
      TENANT_A,
      Effect.gen(function* () {
        const tenantQuery = yield* TenantQuery;
        const where = yield* tenantQuery.whereTenantId(
          categories,
          tenantBRow!.id,
        );
        yield* Effect.promise(() =>
          getTestDb().delete(categories).where(where),
        );
      }),
    );

    const remaining = await getTestDb().query.categories.findFirst({
      where: eq(categories.id, tenantBRow!.id),
    });

    expect(remaining).toBeTruthy();
  });
});
