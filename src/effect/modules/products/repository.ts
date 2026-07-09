import { Effect } from 'effect';
import { eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
} from '@stocket/types/common';
import { makeTenantCrud } from '../../platform/db/tenant-crud';
import { products } from '../../platform/db/schema';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import { ProductsInfrastructureError } from './products.errors';
import {
  buildProductFilters,
  getProductOrderBy,
  mapProductRow,
  selectProductWithJoins,
} from './queries';
import type { ProductQueryDto } from './types';

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
            const where = yield* scopedWhere(
              ...activeConditions(includeDeleted),
            );
            return yield* tryAsync(
              'list all products with relations',
              async () => {
                const rows = await selectProductWithJoins(db)
                  .where(where)
                  .orderBy(sql`products."name" ASC`);
                return rows.map(mapProductRow);
              },
            );
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
                .orderBy(getProductOrderBy(query))
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
            return yield* tryAsync(
              'find product with relations by id',
              async () => {
                const rows = await selectProductWithJoins(db)
                  .where(where)
                  .limit(1);
                return rows[0] ? mapProductRow(rows[0]) : null;
              },
            );
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
            return yield* tryAsync(
              'find products by ids with relations',
              async () => {
                const rows = await selectProductWithJoins(db).where(where);
                return rows.map(mapProductRow);
              },
            );
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
