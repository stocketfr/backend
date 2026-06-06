import { Effect } from 'effect';
import type { Schema } from 'effect';
import {
  eq,
  and,
  ilike,
  or,
  gte,
  lte,
  isNull,
  isNotNull,
  inArray,
  sql,
  type SQL,
} from 'drizzle-orm';
import { ProductSortField } from '@stocket/types/products';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
} from '@stocket/types/common';
import type { ProductQuerySchema } from '@stocket/types/products';
import { buildOrderBy } from '../../platform/drizzle-sort.utils';
import { makeTryAsync } from '../../platform/try-async';
import { TenantQuery } from '../../platform/tenant-query';
import { DrizzleDatabase, type DrizzleDb } from '../../platform/drizzle';
import { products, categories, suppliers } from '../../platform/db/schema';
import { ProductsInfrastructureError } from './products.errors';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new ProductsInfrastructureError({
      action,
      cause,
      messageKey: 'products.repositoryFailed',
    }),
);

const productSortColumns = {
  [ProductSortField.NAME]: products.name,
  [ProductSortField.SKU]: products.sku,
  [ProductSortField.CREATED_AT]: products.created_at,
  [ProductSortField.UPDATED_AT]: products.updated_at,
  [ProductSortField.STANDARD_PRICE]: products.standard_price,
  [ProductSortField.STANDARD_COST]: products.standard_cost,
  [ProductSortField.REORDER_POINT]: products.reorder_point,
} as const;

type ProductQueryDto = Schema.Schema.Type<typeof ProductQuerySchema>;

interface ProductJoinRow {
  product: typeof products.$inferSelect;
  category: typeof categories.$inferSelect | null;
  supplier: typeof suppliers.$inferSelect | null;
}

function selectProductWithJoins(db: DrizzleDb) {
  return db
    .select({
      product: products,
      category: categories,
      supplier: suppliers,
    })
    .from(products)
    .leftJoin(
      categories,
      and(
        eq(products.category_id, categories.id),
        eq(products.tenant_id, categories.tenant_id),
      ),
    )
    .leftJoin(
      suppliers,
      and(
        eq(products.primary_supplier_id, suppliers.id),
        eq(products.tenant_id, suppliers.tenant_id),
      ),
    );
}

function mapProductRow(row: ProductJoinRow) {
  return {
    ...row.product,
    category: row.category,
    primary_supplier: row.supplier,
  };
}

function buildProductFilters(query: ProductQueryDto): SQL[] {
  const conditions: SQL[] = [];
  if (!query.include_deleted) {
    conditions.push(isNull(products.deleted_at));
  }
  if (query.search) {
    conditions.push(
      or(
        ilike(products.name, `%${query.search}%`),
        ilike(products.sku, `%${query.search}%`),
      )!,
    );
  }
  if (query.category_id) {
    conditions.push(eq(products.category_id, query.category_id));
  }
  if (query.primary_supplier_id) {
    conditions.push(
      eq(products.primary_supplier_id, query.primary_supplier_id),
    );
  }
  if (query.is_active !== undefined) {
    conditions.push(eq(products.is_active, query.is_active));
  }
  if (query.is_perishable !== undefined) {
    conditions.push(eq(products.is_perishable, query.is_perishable));
  }
  if (query.min_price !== undefined && query.max_price !== undefined) {
    conditions.push(
      sql`${products.standard_price} BETWEEN ${query.min_price} AND ${query.max_price}`,
    );
  } else if (query.min_price !== undefined) {
    conditions.push(gte(products.standard_price, query.min_price));
  } else if (query.max_price !== undefined) {
    conditions.push(lte(products.standard_price, query.max_price));
  }
  return conditions;
}

export class ProductsRepository extends Effect.Service<ProductsRepository>()(
  '@stocket/effect/products/ProductsRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;

      const findAllPaginated = (query: ProductQueryDto) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            products,
            ...buildProductFilters(query),
          );
          return yield* tryAsync('list products paginated', async () => {
            const { page, limit, skip } = resolvePaginationWindow(
              query.page,
              query.limit,
            );
            const orderBy = buildOrderBy(
              productSortColumns,
              query.sort_by,
              query.sort_order,
            );

            const [countResult] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(products)
              .where(where);

            const total = countResult?.count ?? 0;

            const rows = await selectProductWithJoins(db)
              .where(where)
              .orderBy(orderBy)
              .offset(skip)
              .limit(limit);

            return toRepositoryPaginatedResult(
              rows.map(mapProductRow),
              total,
              page,
              limit,
            );
          });
        });

      const findAll = (includeDeleted = false) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            products,
            ...(includeDeleted ? [] : [isNull(products.deleted_at)]),
          );
          return yield* tryAsync('list all products', async () => {
            const rows = await selectProductWithJoins(db)
              .where(where)
              .orderBy(sql`products."name" ASC`);
            return rows.map(mapProductRow);
          });
        });

      const findById = (id: string, includeDeleted = false) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(
            products,
            id,
            ...(includeDeleted ? [] : [isNull(products.deleted_at)]),
          );
          return yield* tryAsync('find product by id', async () => {
            const rows = await selectProductWithJoins(db)
              .where(where)
              .limit(1);
            return rows[0] ? mapProductRow(rows[0]) : null;
          });
        });

      const findBySku = (sku: string, includeDeleted = false) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            products,
            eq(products.sku, sku),
            ...(includeDeleted ? [] : [isNull(products.deleted_at)]),
          );
          return yield* tryAsync('find product by sku', async () => {
            const rows = await db
              .select()
              .from(products)
              .where(where)
              .limit(1);
            return rows[0] ?? null;
          });
        });

      const findByCategoryId = (categoryId: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            products,
            eq(products.category_id, categoryId),
            isNull(products.deleted_at),
          );
          return yield* tryAsync('find products by category', async () => {
            const rows = await selectProductWithJoins(db)
              .where(where)
              .orderBy(sql`products."name" ASC`);
            return rows.map(mapProductRow);
          });
        });

      const findByCategoryIds = (categoryIds: string[]) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            products,
            inArray(products.category_id, categoryIds),
            isNull(products.deleted_at),
          );
          return yield* tryAsync('find products by categories', async () => {
            if (categoryIds.length === 0) return [];

            const rows = await selectProductWithJoins(db)
              .where(where)
              .orderBy(sql`products."name" ASC`);
            return rows.map(mapProductRow);
          });
        });

      const findByIds = (ids: string[], includeDeleted = false) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantIds(
            products,
            ids,
            ...(includeDeleted ? [] : [isNull(products.deleted_at)]),
          );
          return yield* tryAsync('find products by ids', async () => {
            return db.select().from(products).where(where);
          });
        });

      const findDeletedByIds = (ids: string[]) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantIds(
            products,
            ids,
            isNotNull(products.deleted_at),
          );
          return yield* tryAsync('find deleted products by ids', () =>
            db.select().from(products).where(where),
          );
        });

      const existsById = (id: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(
            products,
            id,
            isNull(products.deleted_at),
          );
          return yield* tryAsync('check product existence', async () => {
            const rows = await db
              .select({ id: products.id })
              .from(products)
              .where(where)
              .limit(1);
            return rows.length > 0;
          });
        });

      const create = (data: typeof products.$inferInsert) =>
        Effect.gen(function* () {
          const values = yield* tenantQuery.insertValues(data);
          return yield* tryAsync('create product', async () => {
            const rows = await db.insert(products).values(values).returning();
            return rows[0]!;
          });
        });

      const update = (
        id: string,
        data: Partial<typeof products.$inferInsert>,
      ) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(
            products,
            id,
            isNull(products.deleted_at),
          );
          return yield* tryAsync('update product', async () => {
            const { tenant_id: _tenantId, ...updateData } = data;
            const rows = await db
              .update(products)
              .set({ ...updateData, updated_at: new Date() })
              .where(where)
              .returning({ id: products.id });
            return rows.length;
          });
        });

      const updateMany = (
        ids: string[],
        data: Partial<typeof products.$inferInsert>,
      ) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantIds(
            products,
            ids,
            isNull(products.deleted_at),
          );
          return yield* tryAsync('update multiple products', async () => {
            const { tenant_id: _tenantId, ...updateData } = data;
            const rows = await db
              .update(products)
              .set({ ...updateData, updated_at: new Date() })
              .where(where)
              .returning({ id: products.id });
            return rows.length;
          });
        });

      const softDelete = (id: string, deletedBy?: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(
            products,
            id,
            isNull(products.deleted_at),
          );
          return yield* tryAsync('soft delete product', async () => {
            await db
              .update(products)
              .set({
                deleted_at: new Date(),
                deleted_by: deletedBy ?? null,
                updated_at: new Date(),
              })
              .where(where);
          });
        });

      const softDeleteMany = (ids: string[], deletedBy?: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantIds(
            products,
            ids,
            isNull(products.deleted_at),
          );
          return yield* tryAsync('soft delete multiple products', async () => {
            const rows = await db
              .update(products)
              .set({
                deleted_at: new Date(),
                deleted_by: deletedBy ?? null,
                updated_at: new Date(),
              })
              .where(where)
              .returning({ id: products.id });
            return rows.length;
          });
        });

      const restore = (id: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(
            products,
            id,
            isNotNull(products.deleted_at),
          );
          return yield* tryAsync('restore product', async () => {
            await db
              .update(products)
              .set({
                deleted_at: null,
                deleted_by: null,
                updated_at: new Date(),
              })
              .where(where);
          });
        });

      const restoreMany = (ids: string[]) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantIds(
            products,
            ids,
            isNotNull(products.deleted_at),
          );
          return yield* tryAsync('restore multiple products', async () => {
            const rows = await db
              .update(products)
              .set({
                deleted_at: null,
                deleted_by: null,
                updated_at: new Date(),
              })
              .where(where)
              .returning({ id: products.id });
            return rows.length;
          });
        });

      const hardDelete = (id: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(products, id);
          return yield* tryAsync('hard delete product', async () => {
            await db.delete(products).where(where);
          });
        });

      const hardDeleteMany = (ids: string[]) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantIds(products, ids);
          return yield* tryAsync('hard delete multiple products', async () => {
            const rows = await db
              .delete(products)
              .where(where)
              .returning({ id: products.id });
            return rows.length;
          });
        });

      return {
        findAllPaginated,
        findAll,
        findById,
        findBySku,
        findByCategoryId,
        findByCategoryIds,
        findByIds,
        findDeletedByIds,
        existsById,
        create,
        update,
        updateMany,
        softDelete,
        softDeleteMany,
        restore,
        restoreMany,
        hardDelete,
        hardDeleteMany,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
