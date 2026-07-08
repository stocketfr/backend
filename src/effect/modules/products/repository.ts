import { Effect } from 'effect';
import type { Schema } from 'effect';
import {
  and,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { ProductSortField } from '@stocket/types/products';
import type { ProductQuerySchema } from '@stocket/types/products';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
} from '@stocket/types/common';
import { buildOrderBy } from '../../platform/db/drizzle-sort.utils';
import { type DrizzleDb } from '../../platform/db/drizzle';
import { makeTenantCrud } from '../../platform/db/tenant-crud';
import { categories, products, suppliers } from '../../platform/db/schema';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import { ProductsInfrastructureError } from './products.errors';

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

const productOrderBy = (query: ProductQueryDto) =>
  buildOrderBy(productSortColumns, query.sort_by, query.sort_order);

export class ProductsRepository extends Effect.Service<ProductsRepository>()(
  '@stocket/effect/products/ProductsRepository',
  {
    effect: makeTenantCrud(products, {
      entity: 'product',
      reads: false,
      onError: (action, cause) =>
        new ProductsInfrastructureError({
          action,
          cause,
          messageKey: 'products.repositoryFailed',
        }),
      softDelete: {
        deletedAt: products.deleted_at,
        deletedBy: products.deleted_by,
      },
      extras: ({ db, tryAsync, scopedWhere, scopedWhereId }) => {
        const activeConditions = (includeDeleted = false): SQL[] =>
          includeDeleted ? [] : [isNull(products.deleted_at)];

        const findAll = (includeDeleted = false) =>
          Effect.gen(function* () {
            const where = yield* scopedWhere(...activeConditions(includeDeleted));
            return yield* tryAsync('list all products with relations', async () => {
              const rows = await selectProductWithJoins(db)
                .where(where)
                .orderBy(sql`products."name" ASC`);
              return rows.map(mapProductRow);
            });
          });

        const findAllPaginated = (query: ProductQueryDto) =>
          Effect.gen(function* () {
            const where = yield* scopedWhere(
              ...activeConditions(query.include_deleted === true),
              ...buildProductFilters(query),
            );
            return yield* tryAsync('list products with relations', async () => {
              const { page, limit, skip } = resolvePaginationWindow(
                query.page,
                query.limit,
              );

              const [countResult] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(products)
                .where(where);

              const rows = await selectProductWithJoins(db)
                .where(where)
                .orderBy(productOrderBy(query))
                .offset(skip)
                .limit(limit);

              return toRepositoryPaginatedResult(
                rows.map(mapProductRow),
                countResult?.count ?? 0,
                page,
                limit,
              );
            });
          });

        const findById = (id: string, includeDeleted = false) =>
          Effect.gen(function* () {
            const where = yield* scopedWhereId(
              id,
              ...activeConditions(includeDeleted),
            );
            return yield* tryAsync('find product with relations by id', async () => {
              const rows = await selectProductWithJoins(db)
                .where(where)
                .limit(1);
              return rows[0] ? mapProductRow(rows[0]) : null;
            });
          });

        const findByIds = (ids: readonly string[], includeDeleted = false) =>
          Effect.gen(function* () {
            if (ids.length === 0) {
              return [];
            }

            const where = yield* scopedWhere(
              inArray(products.id, [...ids]),
              ...activeConditions(includeDeleted),
            );
            return yield* tryAsync('find products by ids with relations', async () => {
              const rows = await selectProductWithJoins(db).where(where);
              return rows.map(mapProductRow);
            });
          });

        const existsById = (id: string, includeDeleted = false) =>
          Effect.gen(function* () {
            const where = yield* scopedWhereId(
              id,
              ...activeConditions(includeDeleted),
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

        const findBySku = (sku: string, includeDeleted = false) =>
          Effect.gen(function* () {
            const where = yield* scopedWhere(
              eq(products.sku, sku),
              ...activeConditions(includeDeleted),
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

        const findBySkus = (skus: readonly string[], includeDeleted = false) =>
          Effect.gen(function* () {
            if (skus.length === 0) {
              return [];
            }

            const where = yield* scopedWhere(
              inArray(products.sku, [...skus]),
              ...activeConditions(includeDeleted),
            );
            return yield* tryAsync('find products by skus', () =>
              db.select().from(products).where(where),
            );
          });

        const findByCategoryId = (categoryId: string) =>
          Effect.gen(function* () {
            const where = yield* scopedWhere(
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

        const findByCategoryIds = (categoryIds: readonly string[]) =>
          Effect.gen(function* () {
            if (categoryIds.length === 0) {
              return [];
            }

            const where = yield* scopedWhere(
              inArray(products.category_id, [...categoryIds]),
              isNull(products.deleted_at),
            );
            return yield* tryAsync('find products by categories', async () => {
              const rows = await selectProductWithJoins(db)
                .where(where)
                .orderBy(sql`products."name" ASC`);
              return rows.map(mapProductRow);
            });
          });

        return {
          findAll,
          findAllPaginated,
          findById,
          findByIds,
          existsById,
          findBySku,
          findBySkus,
          findByCategoryId,
          findByCategoryIds,
        };
      },
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
