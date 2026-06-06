import { Effect } from 'effect';
import { eq, or, gte, lte, sql, type SQL, desc } from 'drizzle-orm';
import type { StockMovementQueryDto } from '@stocket/types/stock-movements';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
} from '@stocket/types/common';
import { makeTryAsync } from '../../platform/try-async';
import { TenantQuery } from '../../platform/tenant-query';
import { DrizzleDatabase } from '../../platform/drizzle';
import { orders, stockMovements } from '../../platform/db/schema';
import { StockMovementsInfrastructureError } from './stock-movements.errors';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new StockMovementsInfrastructureError({
      action,
      cause,
      messageKey: 'stockMovements.repositoryFailed',
    }),
);

const withRelations = {
  product: { columns: { id: true, name: true, sku: true } },
  fromLocation: { columns: { id: true, name: true } },
  toLocation: { columns: { id: true, name: true } },
} as const;

function buildStockMovementFilters(query: StockMovementQueryDto): SQL[] {
  const conditions: SQL[] = [];
  if (query.product_id) {
    conditions.push(eq(stockMovements.product_id, query.product_id));
  }
  if (query.location_id) {
    conditions.push(
      or(
        eq(stockMovements.from_location_id, query.location_id),
        eq(stockMovements.to_location_id, query.location_id),
      )!,
    );
  }
  if (query.reason) {
    conditions.push(eq(stockMovements.reason, query.reason));
  }
  if (query.date_from) {
    conditions.push(gte(stockMovements.created_at, new Date(query.date_from)));
  }
  if (query.date_to) {
    conditions.push(lte(stockMovements.created_at, new Date(query.date_to)));
  }
  return conditions;
}

export class StockMovementsRepository extends Effect.Service<StockMovementsRepository>()(
  '@stocket/effect/stock-movements/StockMovementsRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;

      const findAllPaginated = (query: StockMovementQueryDto) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            stockMovements,
            ...buildStockMovementFilters(query),
          );
          return yield* tryAsync('list stock movements paginated', async () => {
            const { page, limit, skip } = resolvePaginationWindow(
              query.page,
              query.limit,
            );

            const [countResult] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(stockMovements)
              .where(where);

            const total = countResult?.count ?? 0;

            const data = await db.query.stockMovements.findMany({
              where,
              with: withRelations,
              orderBy: desc(stockMovements.created_at),
              offset: skip,
              limit,
            });

            return toRepositoryPaginatedResult(data, total, page, limit);
          });
        });

      const findById = (id: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(stockMovements, id);
          return yield* tryAsync('find stock movement by id', async () => {
            const row = await db.query.stockMovements.findFirst({
              where,
              with: withRelations,
            });

            return row ?? null;
          });
        });

      const findByProductId = (productId: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            stockMovements,
            eq(stockMovements.product_id, productId),
          );
          return yield* tryAsync('find stock movements by product', () =>
            db.query.stockMovements.findMany({
              where,
              with: withRelations,
              orderBy: desc(stockMovements.created_at),
            }),
          );
        });

      const findByLocationId = (locationId: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            stockMovements,
            or(
              eq(stockMovements.from_location_id, locationId),
              eq(stockMovements.to_location_id, locationId),
            )!,
          );
          return yield* tryAsync('find stock movements by location', () =>
            db.query.stockMovements.findMany({
              where,
              with: withRelations,
              orderBy: desc(stockMovements.created_at),
            }),
          );
        });

      const create = (data: typeof stockMovements.$inferInsert) =>
        Effect.gen(function* () {
          const values = yield* tenantQuery.insertValues(data);
          return yield* tryAsync('create stock movement', async () => {
            const rows = await db
              .insert(stockMovements)
              .values(values)
              .returning();
            return rows[0]!;
          });
        });

      const orderExistsById = (orderId: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(orders, orderId);
          return yield* tryAsync(
            'check stock movement order tenant',
            async () => {
              const rows = await db
                .select({ id: orders.id })
                .from(orders)
                .where(where)
                .limit(1);
              return rows.length > 0;
            },
          );
        });

      return {
        findAllPaginated,
        findById,
        findByProductId,
        findByLocationId,
        create,
        orderExistsById,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
