import { Effect } from 'effect';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  InventoryQueryDto,
  InventorySummaryDto,
} from '@stocket/types/inventory';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
} from '@stocket/types/common';
import { makeTenantCrud } from '../../platform/db/tenant-crud';
import { inventory, products } from '../../platform/db/schema';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import { InventoryInfrastructureError } from './inventory.errors';
import {
  buildInventoryFilters,
  getInventoryOrderBy,
  mapInventoryRow,
  selectInventoryWithJoins,
} from './queries';
import type { InventoryWithRelations } from './types';

export type { InventoryWithRelations };

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
            const where = yield* scopedWhere(
              eq(inventory.product_id, productId),
            );
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
