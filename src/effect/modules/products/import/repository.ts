import { Cause, Chunk, Effect, Exit, Layer, Option } from 'effect';
import { eq, isNull, sql, type SQL } from 'drizzle-orm';
import { makeTryAsync } from '../../../platform/effect/try-async';
import { DrizzleDatabase, type DrizzleDb } from '../../../platform/db/drizzle';
import { withDrizzleTransaction } from '../../../platform/db/transaction';
import { TenantQuery } from '../../../platform/tenancy/tenant-query';
import {
  areas,
  categories,
  inventory,
  locations,
  products,
} from '../../../platform/db/schema';
import { ProductsInfrastructureError } from '../products.errors';
import type {
  ProductImportRowRepository,
  ProductImportRowTransactionError,
} from './row/import';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new ProductsInfrastructureError({
      action,
      cause,
      messageKey: 'products.repositoryFailed',
    }),
);

const inventoryProductLocationConditions = (
  productId: string,
  locationId: string,
): SQL[] => [
  eq(inventory.product_id, productId),
  eq(inventory.location_id, locationId),
];

export class ProductImportTransactionDefect extends Error {
  private constructor(
    message: string,
    readonly failure: ProductImportRowTransactionError | null,
    readonly nonFailureCause: Cause.Cause<ProductImportRowTransactionError> | null,
  ) {
    super(message);
    this.name = 'ProductImportTransactionDefect';
  }

  static failure(failure: ProductImportRowTransactionError) {
    return new ProductImportTransactionDefect(failure.message, failure, null);
  }

  static nonFailure(cause: Cause.Cause<ProductImportRowTransactionError>) {
    return new ProductImportTransactionDefect(Cause.pretty(cause), null, cause);
  }
}

export const runProductImportEffectAsPromise = async <A>(
  effect: Effect.Effect<A, ProductImportRowTransactionError, never>,
): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;

  if (
    !Cause.isDie(exit.cause) &&
    !Cause.isInterrupted(exit.cause) &&
    Chunk.size(Cause.failures(exit.cause)) === 1
  ) {
    const failure = Cause.failureOption(exit.cause);
    if (Option.isSome(failure)) {
      throw ProductImportTransactionDefect.failure(failure.value);
    }
  }
  throw ProductImportTransactionDefect.nonFailure(exit.cause);
};

export const restoreProductImportTransactionError = (
  error: ProductImportTransactionDefect | ProductsInfrastructureError,
): Effect.Effect<never, ProductImportRowTransactionError> => {
  if (!(error instanceof ProductImportTransactionDefect)) {
    return Effect.fail(error);
  }
  if (error.failure !== null) return Effect.fail(error.failure);
  if (error.nonFailureCause !== null) {
    return Effect.failCause(error.nonFailureCause);
  }
  return Effect.dieMessage('Product import transaction exit was empty');
};

export class ProductImportRepository extends Effect.Service<ProductImportRepository>()(
  '@stocket/effect/products/ProductImportRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;

      const findCategoryByNameAndParent = (
        name: string,
        parentId: string | null,
      ) =>
        Effect.gen(function* () {
          const conditions: SQL[] = [eq(categories.name, name)];
          conditions.push(
            parentId === null
              ? isNull(categories.parent_id)
              : eq(categories.parent_id, parentId),
          );
          const where = yield* tenantQuery.whereTenant(
            categories,
            ...conditions,
          );
          return yield* tryAsync('find import category', async () => {
            const rows = await db
              .select()
              .from(categories)
              .where(where)
              .limit(1);
            return rows[0] ?? null;
          });
        });

      const createCategory = (data: typeof categories.$inferInsert) =>
        Effect.gen(function* () {
          const values = yield* tenantQuery.insertValues(data);
          return yield* tryAsync('create import category', async () => {
            const rows = await db.insert(categories).values(values).returning();
            return rows[0]!;
          });
        });

      const findCategoryById = (id: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(categories, id);
          return yield* tryAsync('find import category by id', async () => {
            const rows = await db
              .select()
              .from(categories)
              .where(where)
              .limit(1);
            return rows[0] ?? null;
          });
        });

      const findLocationByName = (name: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            locations,
            eq(locations.name, name),
          );
          return yield* tryAsync('find import location', async () => {
            const rows = await db
              .select()
              .from(locations)
              .where(where)
              .limit(1);
            return rows[0] ?? null;
          });
        });

      const findLocationById = (id: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(locations, id);
          return yield* tryAsync('find import location by id', async () => {
            const rows = await db
              .select()
              .from(locations)
              .where(where)
              .limit(1);
            return rows[0] ?? null;
          });
        });

      const createLocation = (data: typeof locations.$inferInsert) =>
        Effect.gen(function* () {
          const values = yield* tenantQuery.insertValues(data);
          return yield* tryAsync('create import location', async () => {
            const rows = await db.insert(locations).values(values).returning();
            return rows[0]!;
          });
        });

      const findAreaByNameLocationAndParent = (
        locationId: string,
        name: string,
        parentId: string | null,
      ) =>
        Effect.gen(function* () {
          const conditions: SQL[] = [
            eq(areas.location_id, locationId),
            eq(areas.name, name),
          ];
          conditions.push(
            parentId === null
              ? isNull(areas.parent_id)
              : eq(areas.parent_id, parentId),
          );
          const where = yield* tenantQuery.whereTenant(areas, ...conditions);
          return yield* tryAsync('find import area', async () => {
            const rows = await db.select().from(areas).where(where).limit(1);
            return rows[0] ?? null;
          });
        });

      const createArea = (data: typeof areas.$inferInsert) =>
        Effect.gen(function* () {
          const values = yield* tenantQuery.insertValues(data);
          return yield* tryAsync('create import area', async () => {
            const rows = await db.insert(areas).values(values).returning();
            return rows[0]!;
          });
        });

      const findAreaById = (id: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(areas, id);
          return yield* tryAsync('find import area by id', async () => {
            const rows = await db.select().from(areas).where(where).limit(1);
            return rows[0] ?? null;
          });
        });

      const findProductBySku = (sku: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            products,
            eq(products.sku, sku),
          );
          return yield* tryAsync('find import product by sku', async () => {
            const rows = await db.select().from(products).where(where).limit(1);
            return rows[0] ?? null;
          });
        });

      const createProduct = (data: typeof products.$inferInsert) =>
        Effect.gen(function* () {
          const values = yield* tenantQuery.insertValues(data);
          return yield* tryAsync('create import product', async () => {
            const rows = await db.insert(products).values(values).returning();
            return rows[0]!;
          });
        });

      const updateProduct = (
        id: string,
        data: Partial<typeof products.$inferInsert>,
      ) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(products, id);
          return yield* tryAsync('update import product', async () => {
            const { tenant_id: _tenantId, ...updateData } = data;
            const rows = await db
              .update(products)
              .set({ ...updateData, updated_at: new Date() })
              .where(where)
              .returning();
            return rows[0] ?? null;
          });
        });

      const findRootInventoryByProductAndLocation = (
        productId: string,
        locationId: string,
      ) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            inventory,
            ...inventoryProductLocationConditions(productId, locationId),
            isNull(inventory.area_id),
          );
          return yield* tryAsync('find import inventory', async () => {
            const rows = await db
              .select()
              .from(inventory)
              .where(where)
              .limit(1);
            return rows[0] ?? null;
          });
        });

      const findInventoryByProductLocationAndArea = (
        productId: string,
        locationId: string,
        areaId: string | null,
      ) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            inventory,
            ...inventoryProductLocationConditions(productId, locationId),
            areaId === null
              ? isNull(inventory.area_id)
              : eq(inventory.area_id, areaId),
          );
          return yield* tryAsync('find import inventory', async () => {
            const rows = await db
              .select()
              .from(inventory)
              .where(where)
              .limit(1);
            return rows[0] ?? null;
          });
        });

      const hasAreaScopedInventoryForProductAndLocation = (
        productId: string,
        locationId: string,
      ) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            inventory,
            ...inventoryProductLocationConditions(productId, locationId),
            sql`${inventory.area_id} IS NOT NULL`,
          );
          return yield* tryAsync('check import area inventory', async () => {
            const rows = await db
              .select({ id: inventory.id })
              .from(inventory)
              .where(where)
              .limit(1);
            return rows.length > 0;
          });
        });

      const createInventory = (data: typeof inventory.$inferInsert) =>
        Effect.gen(function* () {
          const values = yield* tenantQuery.insertValues(data);
          return yield* tryAsync('create import inventory', async () => {
            const rows = await db.insert(inventory).values(values).returning();
            return rows[0]!;
          });
        });

      const updateInventory = (
        id: string,
        data: Partial<typeof inventory.$inferInsert>,
      ) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(inventory, id);
          return yield* tryAsync('update import inventory', async () => {
            const { tenant_id: _tenantId, ...updateData } = data;
            const rows = await db
              .update(inventory)
              .set({ ...updateData, updated_at: new Date() })
              .where(where)
              .returning();
            return rows[0] ?? null;
          });
        });

      const runRowTransaction = <A>(
        run: (
          transactionRepository: ProductImportRowRepository,
        ) => Effect.Effect<A, ProductImportRowTransactionError>,
      ) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          const tenantScope = tenantQuery.forTenant(tenantId);
          const transactionTenantQuery = {
            _tag: '@stocket/effect/platform/TenantQuery' as const,
            forTenant: tenantQuery.forTenant,
            tenantId: Effect.succeed(tenantId),
            tenantPredicate: (
              table: Parameters<typeof tenantScope.tenantPredicate>[0],
            ) => Effect.succeed(tenantScope.tenantPredicate(table)),
            whereTenant: (
              table: Parameters<typeof tenantScope.whereTenant>[0],
              ...conditions: SQL[]
            ) => Effect.succeed(tenantScope.whereTenant(table, ...conditions)),
            whereTenantId: (
              table: Parameters<typeof tenantScope.whereTenantId>[0],
              id: string,
              ...conditions: SQL[]
            ) =>
              Effect.succeed(
                tenantScope.whereTenantId(table, id, ...conditions),
              ),
            whereTenantIds: (
              table: Parameters<typeof tenantScope.whereTenantIds>[0],
              ids: readonly string[],
              ...conditions: SQL[]
            ) =>
              Effect.succeed(
                tenantScope.whereTenantIds(table, ids, ...conditions),
              ),
            insertValues: <T extends object>(data: T) =>
              Effect.succeed(tenantScope.insertValues(data)),
          };

          return yield* Effect.tryPromise({
            try: () =>
              withDrizzleTransaction(db, async (transactionDb: DrizzleDb) => {
                const transactionPlatformLayer = Layer.merge(
                  Layer.succeed(DrizzleDatabase, transactionDb),
                  Layer.succeed(TenantQuery, transactionTenantQuery),
                );
                const transactionRepositoryLayer =
                  ProductImportRepository.DefaultWithoutDependencies.pipe(
                    Layer.provide(transactionPlatformLayer),
                  );
                const transactionEffect = Effect.gen(function* () {
                  const transactionRepository = yield* ProductImportRepository;
                  return yield* run(transactionRepository);
                }).pipe(Effect.provide(transactionRepositoryLayer));

                return runProductImportEffectAsPromise(transactionEffect);
              }),
            catch: (cause) =>
              cause instanceof ProductImportTransactionDefect
                ? cause
                : new ProductsInfrastructureError({
                    action: 'run product import row transaction',
                    cause,
                    messageKey: 'products.repositoryFailed',
                  }),
          }).pipe(Effect.catchAll(restoreProductImportTransactionError));
        });

      return {
        findCategoryByNameAndParent,
        findCategoryById,
        createCategory,
        findLocationByName,
        findLocationById,
        createLocation,
        findAreaByNameLocationAndParent,
        findAreaById,
        createArea,
        findProductBySku,
        createProduct,
        updateProduct,
        findRootInventoryByProductAndLocation,
        findInventoryByProductLocationAndArea,
        hasAreaScopedInventoryForProductAndLocation,
        createInventory,
        updateInventory,
        runRowTransaction,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
