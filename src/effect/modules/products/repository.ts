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

export class ProductsRepository extends Effect.Service<ProductsRepository>()(
  '@stocket/effect/products/ProductsRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;

      const findAllPaginated = (query: ProductQueryDto) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('list products paginated', async () => {
            const { page, limit, skip } = resolvePaginationWindow(
              query.page,
              query.limit,
            );

            const conditions: SQL[] = [eq(products.tenant_id, tenantId)];

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
            if (
              query.min_price !== undefined &&
              query.max_price !== undefined
            ) {
              conditions.push(
                sql`${products.standard_price} BETWEEN ${query.min_price} AND ${query.max_price}`,
              );
            } else if (query.min_price !== undefined) {
              conditions.push(gte(products.standard_price, query.min_price));
            } else if (query.max_price !== undefined) {
              conditions.push(lte(products.standard_price, query.max_price));
            }

            const where = and(...conditions);
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
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('list all products', async () => {
            const conditions: SQL[] = [eq(products.tenant_id, tenantId)];
            if (!includeDeleted) conditions.push(isNull(products.deleted_at));
            const rows = await selectProductWithJoins(db)
              .where(and(...conditions))
              .orderBy(sql`products."name" ASC`);
            return rows.map(mapProductRow);
          });
        });

      const findById = (id: string, includeDeleted = false) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('find product by id', async () => {
            const conditions: SQL[] = [
              eq(products.tenant_id, tenantId),
              eq(products.id, id),
            ];
            if (!includeDeleted) {
              conditions.push(isNull(products.deleted_at));
            }
            const rows = await selectProductWithJoins(db)
              .where(and(...conditions))
              .limit(1);
            return rows[0] ? mapProductRow(rows[0]) : null;
          });
        });

      const findBySku = (sku: string, includeDeleted = false) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('find product by sku', async () => {
            const conditions: SQL[] = [
              eq(products.tenant_id, tenantId),
              eq(products.sku, sku),
            ];
            if (!includeDeleted) {
              conditions.push(isNull(products.deleted_at));
            }
            const rows = await db
              .select()
              .from(products)
              .where(and(...conditions))
              .limit(1);
            return rows[0] ?? null;
          });
        });

      const findByCategoryId = (categoryId: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('find products by category', async () => {
            const rows = await selectProductWithJoins(db)
              .where(
                and(
                  eq(products.tenant_id, tenantId),
                  eq(products.category_id, categoryId),
                  isNull(products.deleted_at),
                ),
              )
              .orderBy(sql`products."name" ASC`);
            return rows.map(mapProductRow);
          });
        });

      const findByCategoryIds = (categoryIds: string[]) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('find products by categories', async () => {
            if (categoryIds.length === 0) return [];

            const rows = await selectProductWithJoins(db)
              .where(
                and(
                  eq(products.tenant_id, tenantId),
                  inArray(products.category_id, categoryIds),
                  isNull(products.deleted_at),
                ),
              )
              .orderBy(sql`products."name" ASC`);
            return rows.map(mapProductRow);
          });
        });

      const findByIds = (ids: string[], includeDeleted = false) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('find products by ids', async () => {
            const conditions: SQL[] = [
              eq(products.tenant_id, tenantId),
              inArray(products.id, ids),
            ];
            if (!includeDeleted) {
              conditions.push(isNull(products.deleted_at));
            }
            return db
              .select()
              .from(products)
              .where(and(...conditions));
          });
        });

      const findDeletedByIds = (ids: string[]) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('find deleted products by ids', () =>
            db
              .select()
              .from(products)
              .where(
                and(
                  eq(products.tenant_id, tenantId),
                  inArray(products.id, ids),
                  isNotNull(products.deleted_at),
                ),
              ),
          );
        });

      const existsById = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('check product existence', async () => {
            const rows = await db
              .select({ id: products.id })
              .from(products)
              .where(
                and(
                  eq(products.tenant_id, tenantId),
                  eq(products.id, id),
                  isNull(products.deleted_at),
                ),
              )
              .limit(1);
            return rows.length > 0;
          });
        });

      const create = (data: typeof products.$inferInsert) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('create product', async () => {
            const rows = await db
              .insert(products)
              .values({ ...data, tenant_id: tenantId })
              .returning();
            return rows[0]!;
          });
        });

      const update = (
        id: string,
        data: Partial<typeof products.$inferInsert>,
      ) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('update product', async () => {
            const { tenant_id: _tenantId, ...updateData } = data;
            const rows = await db
              .update(products)
              .set({ ...updateData, updated_at: new Date() })
              .where(
                and(
                  eq(products.tenant_id, tenantId),
                  eq(products.id, id),
                  isNull(products.deleted_at),
                ),
              )
              .returning({ id: products.id });
            return rows.length;
          });
        });

      const updateMany = (
        ids: string[],
        data: Partial<typeof products.$inferInsert>,
      ) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('update multiple products', async () => {
            const { tenant_id: _tenantId, ...updateData } = data;
            const rows = await db
              .update(products)
              .set({ ...updateData, updated_at: new Date() })
              .where(
                and(
                  eq(products.tenant_id, tenantId),
                  inArray(products.id, ids),
                  isNull(products.deleted_at),
                ),
              )
              .returning({ id: products.id });
            return rows.length;
          });
        });

      const softDelete = (id: string, deletedBy?: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('soft delete product', async () => {
            await db
              .update(products)
              .set({
                deleted_at: new Date(),
                deleted_by: deletedBy ?? null,
                updated_at: new Date(),
              })
              .where(
                and(
                  eq(products.tenant_id, tenantId),
                  eq(products.id, id),
                  isNull(products.deleted_at),
                ),
              );
          });
        });

      const softDeleteMany = (ids: string[], deletedBy?: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('soft delete multiple products', async () => {
            const rows = await db
              .update(products)
              .set({
                deleted_at: new Date(),
                deleted_by: deletedBy ?? null,
                updated_at: new Date(),
              })
              .where(
                and(
                  eq(products.tenant_id, tenantId),
                  inArray(products.id, ids),
                  isNull(products.deleted_at),
                ),
              )
              .returning({ id: products.id });
            return rows.length;
          });
        });

      const restore = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('restore product', async () => {
            await db
              .update(products)
              .set({
                deleted_at: null,
                deleted_by: null,
                updated_at: new Date(),
              })
              .where(
                and(
                  eq(products.tenant_id, tenantId),
                  eq(products.id, id),
                  isNotNull(products.deleted_at),
                ),
              );
          });
        });

      const restoreMany = (ids: string[]) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('restore multiple products', async () => {
            const rows = await db
              .update(products)
              .set({
                deleted_at: null,
                deleted_by: null,
                updated_at: new Date(),
              })
              .where(
                and(
                  eq(products.tenant_id, tenantId),
                  inArray(products.id, ids),
                  isNotNull(products.deleted_at),
                ),
              )
              .returning({ id: products.id });
            return rows.length;
          });
        });

      const hardDelete = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('hard delete product', async () => {
            await db
              .delete(products)
              .where(
                and(eq(products.tenant_id, tenantId), eq(products.id, id)),
              );
          });
        });

      const hardDeleteMany = (ids: string[]) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('hard delete multiple products', async () => {
            const rows = await db
              .delete(products)
              .where(
                and(
                  eq(products.tenant_id, tenantId),
                  inArray(products.id, ids),
                ),
              )
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
