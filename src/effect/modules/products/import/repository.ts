import { Effect } from 'effect';
import { eq, isNull, sql, type SQL } from 'drizzle-orm';
import { makeTryAsync } from '../../../platform/effect/try-async';
import { DrizzleDatabase } from '../../../platform/db/drizzle';
import { TenantQuery } from '../../../platform/tenancy/tenant-query';
import {
  areas,
  categories,
  inventory,
  locations,
  products,
} from '../../../platform/db/schema';
import { ProductsInfrastructureError } from '../products.errors';

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

      const createLocation = (data: typeof locations.$inferInsert) =>
        Effect.gen(function* () {
          const values = yield* tenantQuery.insertValues(data);
          return yield* tryAsync('create import location', async () => {
            const rows = await db.insert(locations).values(values).returning();
            return rows[0]!;
          });
        });

      const findAreaByNameLocationAndParent = (
        name: string,
        locationId: string,
        parentId: string | null,
      ) =>
        Effect.gen(function* () {
          const conditions: SQL[] = [
            eq(areas.name, name),
            eq(areas.location_id, locationId),
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

      const findInventoryByProductLocationArea = (
        productId: string,
        locationId: string,
        areaId: string | null,
      ) =>
        Effect.gen(function* () {
          const areaCondition =
            areaId === null
              ? isNull(inventory.area_id)
              : eq(inventory.area_id, areaId);
          const where = yield* tenantQuery.whereTenant(
            inventory,
            ...inventoryProductLocationConditions(productId, locationId),
            areaCondition,
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

      const findRootInventoryByProductAndLocation = (
        productId: string,
        locationId: string,
      ) => findInventoryByProductLocationArea(productId, locationId, null);

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

      return {
        findCategoryByNameAndParent,
        createCategory,
        findLocationByName,
        createLocation,
        findAreaByNameLocationAndParent,
        createArea,
        findProductBySku,
        createProduct,
        updateProduct,
        findInventoryByProductLocationArea,
        findRootInventoryByProductAndLocation,
        hasAreaScopedInventoryForProductAndLocation,
        createInventory,
        updateInventory,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
