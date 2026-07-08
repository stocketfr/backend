import { Effect } from 'effect';
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type {
  InventoryQueryDto,
  InventorySummaryDto,
} from '@stocket/types/inventory';
import { InventorySortField } from '@stocket/types/inventory';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
} from '@stocket/types/common';
import { buildOrderBy } from '../../platform/db/drizzle-sort.utils';
import { type DrizzleDb } from '../../platform/db/drizzle';
import { makeTenantCrud } from '../../platform/db/tenant-crud';
import { areas, inventory, locations, products } from '../../platform/db/schema';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import { InventoryInfrastructureError } from './inventory.errors';

type InventoryRow = typeof inventory.$inferSelect;
export type InventoryWithRelations = InventoryRow & {
  product: typeof products.$inferSelect | null;
  location: typeof locations.$inferSelect | null;
  area: typeof areas.$inferSelect | null;
};

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
    .leftJoin(
      products,
      and(
        eq(inventory.product_id, products.id),
        eq(inventory.tenant_id, products.tenant_id),
      ),
    )
    .leftJoin(
      locations,
      and(
        eq(inventory.location_id, locations.id),
        eq(inventory.tenant_id, locations.tenant_id),
      ),
    )
    .leftJoin(
      areas,
      and(
        eq(inventory.area_id, areas.id),
        eq(inventory.tenant_id, areas.tenant_id),
      ),
    );
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
    effect: makeTenantCrud(inventory, {
      entity: { singular: 'inventory item', plural: 'inventory items' },
      reads: false,
      onError: (action, cause) =>
        new InventoryInfrastructureError({
          action,
          cause,
          messageKey: 'inventory.infrastructureFailed',
        }),
      extras: ({ db, tryAsync, scopedWhere, scopedWhereId }) => {
        const findAllPaginatedWithRelations = (query: InventoryQueryDto) =>
          Effect.gen(function* () {
            const where = yield* scopedWhere(...buildInventoryFilters(query));
            return yield* tryAsync('list inventory paginated', async () => {
              const { page, limit, skip } = resolvePaginationWindow(
                query.page,
                query.limit,
              );
              const orderBy = getInventoryOrderBy(
                query.sort_by,
                query.sort_order,
              );

              const [countResult] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(inventory)
                .leftJoin(
                  products,
                  and(
                    eq(inventory.product_id, products.id),
                    eq(inventory.tenant_id, products.tenant_id),
                  ),
                )
                .where(where);

              const rows = await selectInventoryWithJoins(db)
                .where(where)
                .orderBy(orderBy)
                .offset(skip)
                .limit(limit);

              return toRepositoryPaginatedResult(
                rows.map(mapInventoryRow),
                countResult?.count ?? 0,
                page,
                limit,
              );
            });
          });

        const findAllWithRelations = () =>
          Effect.gen(function* () {
            const where = yield* scopedWhere();
            return yield* tryAsync('list all inventory', async () => {
              const rows = await selectInventoryWithJoins(db)
                .where(where)
                .orderBy(desc(inventory.updated_at));
              return rows.map(mapInventoryRow);
            });
          });

        const findByIdWithRelations = (id: string) =>
          Effect.gen(function* () {
            const where = yield* scopedWhereId(id);
            return yield* tryAsync('find inventory by id', async () => {
              const rows = await selectInventoryWithJoins(db)
                .where(where)
                .limit(1);
              return rows[0] ? mapInventoryRow(rows[0]) : null;
            });
          });

        const findByProductIdWithRelations = (productId: string) =>
          Effect.gen(function* () {
            const where = yield* scopedWhere(eq(inventory.product_id, productId));
            return yield* tryAsync('find inventory by product', async () => {
              const rows = await selectInventoryWithJoins(db)
                .where(where)
                .orderBy(desc(inventory.updated_at));
              return rows.map(mapInventoryRow);
            });
          });

        const findByLocationIdWithRelations = (locationId: string) =>
          Effect.gen(function* () {
            const where = yield* scopedWhere(
              eq(inventory.location_id, locationId),
            );
            return yield* tryAsync('find inventory by location', async () => {
              const rows = await selectInventoryWithJoins(db)
                .where(where)
                .orderBy(desc(inventory.updated_at));
              return rows.map(mapInventoryRow);
            });
          });

        const findByProductAndLocationWithRelations = (
          productId: string,
          locationId: string,
          areaId?: string | null,
        ) =>
          Effect.gen(function* () {
            const areaCondition = areaId
              ? eq(inventory.area_id, areaId)
              : isNull(inventory.area_id);
            const where = yield* scopedWhere(
              eq(inventory.product_id, productId),
              eq(inventory.location_id, locationId),
              areaCondition,
            );
            return yield* tryAsync(
              'find inventory by product and location',
              async () => {
                const rows = await selectInventoryWithJoins(db)
                  .where(where)
                  .limit(1);
                return rows[0] ? mapInventoryRow(rows[0]) : null;
              },
            );
          });

        const adjustQuantity = (id: string, adjustment: number) =>
          Effect.gen(function* () {
            const where = yield* scopedWhereId(
              id,
              sql`${inventory.quantity} + ${adjustment} >= 0`,
            );
            return yield* tryAsync('adjust inventory quantity', async () => {
              const rows = await db
                .update(inventory)
                .set({
                  quantity: sql`${inventory.quantity} + ${adjustment}`,
                  updated_at: new Date(),
                })
                .where(where)
                .returning({ id: inventory.id });
              return rows.length;
            });
          });

        const findSummary = () =>
          Effect.gen(function* () {
            const where = yield* scopedWhere();
            return yield* tryAsync(
              'get inventory summary',
              async (): Promise<InventorySummaryDto> => {
                const [row] = await db
                  .select({
                    low_stock_count: sql<number>`count(*) filter (where ${inventory.quantity} <= ${products.reorder_point})::int`,
                    expiring_soon_count: sql<number>`count(*) filter (where ${inventory.expiry_date} is not null and ${inventory.expiry_date} <= now() + interval '30 days')::int`,
                  })
                  .from(inventory)
                  .leftJoin(
                    products,
                    and(
                      eq(inventory.product_id, products.id),
                      eq(inventory.tenant_id, products.tenant_id),
                    ),
                  )
                  .where(where);
                return {
                  low_stock_count: row?.low_stock_count ?? 0,
                  expiring_soon_count: row?.expiring_soon_count ?? 0,
                };
              },
            );
          });

        return {
          findAllPaginatedWithRelations,
          findAllWithRelations,
          findByIdWithRelations,
          findByProductIdWithRelations,
          findByLocationIdWithRelations,
          findByProductAndLocationWithRelations,
          adjustQuantity,
          findSummary,
        };
      },
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
