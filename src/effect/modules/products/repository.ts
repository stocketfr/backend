import { Effect } from 'effect';
import { asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
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

        const findPaginated = (
          query: ProductQueryDto,
          additionalConditions: readonly SQL[] = [],
        ) =>
          Effect.gen(function* () {
            const where = yield* scopedWhere(
              ...activeConditions(query.include_deleted === true),
              ...buildProductFilters(query),
              ...additionalConditions,
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
                .orderBy(getProductOrderBy(query), asc(products.id))
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

        const findAllPaginated = (query: ProductQueryDto) =>
          findPaginated(query);

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

        const findByCategoryIdsPaginated = (
          categoryIds: readonly string[],
          query: ProductQueryDto,
        ) =>
          categoryIds.length === 0
            ? Effect.succeed(
                toRepositoryPaginatedResult([], 0, query.page, query.limit),
              )
            : findPaginated(query, [
                inArray(products.category_id, [...categoryIds]),
              ]);

        return {
          findAllPaginated,
          findById,
          findByIds,
          existsById,
          findBySku,
          findBySkus,
          findByCategoryIdsPaginated,
        };
      },
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
