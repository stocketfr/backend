import { Effect } from 'effect';
import {
  eq,
  and,
  ilike,
  or,
  gte,
  lte,
  desc,
  sql,
  isNull,
  type SQL,
} from 'drizzle-orm';
import type {
  InventoryQueryDto,
  InventorySummaryDto,
} from '@stocket/types/inventory';
import { InventorySortField } from '@stocket/types/inventory';
import { buildOrderBy } from '../../platform/drizzle-sort.utils';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
  type RepositoryPaginatedResult,
} from '@stocket/types/common';
import { makeTryAsync } from '../../platform/try-async';
import { TenantQuery } from '../../platform/tenant-query';
import { DrizzleDatabase, type DrizzleDb } from '../../platform/drizzle';
import {
  inventory,
  products,
  locations,
  areas,
} from '../../platform/db/schema';
import type { TenantNotResolved } from '../../platform/tenant-context';
import { InventoryInfrastructureError } from './inventory.errors';

type InventoryRow = typeof inventory.$inferSelect;
export type InventoryWithRelations = InventoryRow & {
  product: typeof products.$inferSelect | null;
  location: typeof locations.$inferSelect | null;
  area: typeof areas.$inferSelect | null;
};

const tryAsync = makeTryAsync(
  (action, cause) =>
    new InventoryInfrastructureError({
      action,
      cause,
      messageKey: 'inventory.infrastructureFailed',
    }),
);

function buildInventoryFilters(query: InventoryQueryDto): SQL[] {
  const conditions: SQL[] = [];
  if (query.product_id) {
    conditions.push(eq(inventory.product_id, query.product_id));
  }
  if (query.location_id) {
    conditions.push(eq(inventory.location_id, query.location_id));
  }
  if (query.area_id) {
    conditions.push(eq(inventory.area_id, query.area_id));
  }
  if (query.search) {
    conditions.push(
      or(
        ilike(products.name, `%${query.search}%`),
        ilike(products.sku, `%${query.search}%`),
      )!,
    );
  }
  if (query.low_stock) {
    conditions.push(sql`${inventory.quantity} <= ${products.reorder_point}`);
  }
  if (query.expiring_soon) {
    conditions.push(
      sql`${inventory.expiry_date} IS NOT NULL AND ${inventory.expiry_date} <= NOW() + INTERVAL '30 days'`,
    );
  }
  if (query.min_quantity !== undefined && query.max_quantity !== undefined) {
    conditions.push(
      sql`${inventory.quantity} BETWEEN ${query.min_quantity} AND ${query.max_quantity}`,
    );
  } else if (query.min_quantity !== undefined) {
    conditions.push(gte(inventory.quantity, query.min_quantity));
  } else if (query.max_quantity !== undefined) {
    conditions.push(lte(inventory.quantity, query.max_quantity));
  }
  return conditions;
}

const inventorySortColumns = {
  [InventorySortField.QUANTITY]: inventory.quantity,
  [InventorySortField.EXPIRY_DATE]: inventory.expiry_date,
  [InventorySortField.RECEIVED_DATE]: inventory.received_date,
  [InventorySortField.CREATED_AT]: inventory.created_at,
  [InventorySortField.UPDATED_AT]: inventory.updated_at,
} as const;

function getInventoryOrderBy(
  sortBy?: InventorySortField,
  sortOrder?: 'ASC' | 'DESC',
) {
  return buildOrderBy(
    inventorySortColumns,
    sortBy ?? InventorySortField.UPDATED_AT,
    sortOrder ?? 'DESC',
  );
}

interface InventoryJoinRow {
  inv: typeof inventory.$inferSelect;
  product: typeof products.$inferSelect | null;
  location: typeof locations.$inferSelect | null;
  area: typeof areas.$inferSelect | null;
}

function selectInventoryWithJoins(db: DrizzleDb) {
  return db
    .select({
      inv: inventory,
      product: products,
      location: locations,
      area: areas,
    })
    .from(inventory)
    .leftJoin(products, eq(inventory.product_id, products.id))
    .leftJoin(locations, eq(inventory.location_id, locations.id))
    .leftJoin(areas, eq(inventory.area_id, areas.id));
}

function mapInventoryRow(row: InventoryJoinRow): InventoryWithRelations {
  return {
    ...row.inv,
    product: row.product,
    location: row.location,
    area: row.area,
  };
}

export class InventoryRepository extends Effect.Service<InventoryRepository>()(
  '@stocket/effect/inventory/InventoryRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;

      const findAllPaginated = (
        query: InventoryQueryDto,
      ): Effect.Effect<
        RepositoryPaginatedResult<InventoryWithRelations>,
        InventoryInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('list inventory paginated', async () => {
            const { page, limit, skip } = resolvePaginationWindow(
              query.page,
              query.limit,
            );
            const where = and(
              eq(inventory.tenant_id, tenantId),
              ...buildInventoryFilters(query),
            );
            const orderBy = getInventoryOrderBy(
              query.sort_by,
              query.sort_order,
            );

            const [countResult] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(inventory)
              .leftJoin(products, eq(inventory.product_id, products.id))
              .where(where);

            const total = countResult?.count ?? 0;

            const rows = await selectInventoryWithJoins(db)
              .where(where)
              .orderBy(orderBy)
              .offset(skip)
              .limit(limit);

            return toRepositoryPaginatedResult(
              rows.map(mapInventoryRow),
              total,
              page,
              limit,
            );
          });
        });

      const findAll = (): Effect.Effect<
        InventoryWithRelations[],
        InventoryInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('list all inventory', async () => {
            const rows = await selectInventoryWithJoins(db)
              .where(eq(inventory.tenant_id, tenantId))
              .orderBy(desc(inventory.updated_at));
            return rows.map(mapInventoryRow);
          });
        });

      const findById = (
        id: string,
      ): Effect.Effect<
        InventoryWithRelations | null,
        InventoryInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('find inventory by id', async () => {
            const rows = await selectInventoryWithJoins(db)
              .where(
                and(eq(inventory.tenant_id, tenantId), eq(inventory.id, id)),
              )
              .limit(1);
            return rows[0] ? mapInventoryRow(rows[0]) : null;
          });
        });

      const findByProductId = (
        productId: string,
      ): Effect.Effect<
        InventoryWithRelations[],
        InventoryInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('find inventory by product', async () => {
            const rows = await selectInventoryWithJoins(db)
              .where(
                and(
                  eq(inventory.tenant_id, tenantId),
                  eq(inventory.product_id, productId),
                ),
              )
              .orderBy(desc(inventory.updated_at));
            return rows.map(mapInventoryRow);
          });
        });

      const findByLocationId = (
        locationId: string,
      ): Effect.Effect<
        InventoryWithRelations[],
        InventoryInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('find inventory by location', async () => {
            const rows = await selectInventoryWithJoins(db)
              .where(
                and(
                  eq(inventory.tenant_id, tenantId),
                  eq(inventory.location_id, locationId),
                ),
              )
              .orderBy(desc(inventory.updated_at));
            return rows.map(mapInventoryRow);
          });
        });

      const findByProductAndLocation = (
        productId: string,
        locationId: string,
        areaId?: string | null,
      ): Effect.Effect<
        InventoryWithRelations | null,
        InventoryInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync(
            'find inventory by product and location',
            async () => {
              const conditions: SQL[] = [
                eq(inventory.tenant_id, tenantId),
                eq(inventory.product_id, productId),
                eq(inventory.location_id, locationId),
              ];

              if (areaId) {
                conditions.push(eq(inventory.area_id, areaId));
              } else {
                conditions.push(isNull(inventory.area_id));
              }

              const rows = await selectInventoryWithJoins(db)
                .where(and(...conditions))
                .limit(1);

              return rows[0] ? mapInventoryRow(rows[0]) : null;
            },
          );
        });

      const create = (
        data: typeof inventory.$inferInsert,
      ): Effect.Effect<
        InventoryRow,
        InventoryInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('create inventory', async () => {
            const rows = await db
              .insert(inventory)
              .values({ ...data, tenant_id: tenantId })
              .returning();
            return rows[0]!;
          });
        });

      const update = (
        id: string,
        data: Partial<typeof inventory.$inferInsert>,
      ): Effect.Effect<
        number,
        InventoryInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('update inventory', async () => {
            const { tenant_id: _tenantId, ...updateData } = data;
            const rows = await db
              .update(inventory)
              .set({ ...updateData, updated_at: new Date() })
              .where(
                and(eq(inventory.tenant_id, tenantId), eq(inventory.id, id)),
              )
              .returning({ id: inventory.id });
            return rows.length;
          });
        });

      const adjustQuantity = (
        id: string,
        adjustment: number,
      ): Effect.Effect<
        number,
        InventoryInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('adjust inventory quantity', async () => {
            const rows = await db
              .update(inventory)
              .set({
                quantity: sql`${inventory.quantity} + ${adjustment}`,
                updated_at: new Date(),
              })
              .where(
                and(
                  eq(inventory.tenant_id, tenantId),
                  eq(inventory.id, id),
                  sql`${inventory.quantity} + ${adjustment} >= 0`,
                ),
              )
              .returning({ id: inventory.id });
            return rows.length;
          });
        });

      const remove = (
        id: string,
      ): Effect.Effect<
        void,
        InventoryInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('delete inventory', async () => {
            await db
              .delete(inventory)
              .where(
                and(eq(inventory.tenant_id, tenantId), eq(inventory.id, id)),
              );
          });
        });

      const findSummary = (): Effect.Effect<
        InventorySummaryDto,
        InventoryInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync(
            'get inventory summary',
            async (): Promise<InventorySummaryDto> => {
              const [row] = await db
                .select({
                  low_stock_count: sql<number>`count(*) filter (where ${inventory.quantity} <= ${products.reorder_point})::int`,
                  expiring_soon_count: sql<number>`count(*) filter (where ${inventory.expiry_date} is not null and ${inventory.expiry_date} <= now() + interval '30 days')::int`,
                })
                .from(inventory)
                .leftJoin(products, eq(inventory.product_id, products.id))
                .where(eq(inventory.tenant_id, tenantId));
              return {
                low_stock_count: row?.low_stock_count ?? 0,
                expiring_soon_count: row?.expiring_soon_count ?? 0,
              };
            },
          );
        });

      return {
        findAllPaginated,
        findAll,
        findById,
        findByProductId,
        findByLocationId,
        findByProductAndLocation,
        create,
        update,
        adjustQuantity,
        delete: remove,
        findSummary,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
