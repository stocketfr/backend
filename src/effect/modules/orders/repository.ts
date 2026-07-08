import { Effect, Schema } from 'effect';
import {
  eq,
  and,
  ilike,
  or,
  gte,
  lte,
  desc,
  inArray,
  sql,
  type SQL,
} from 'drizzle-orm';
import { OrderStatus, type OrderQuerySchema } from '@stocket/types/orders';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
} from '@stocket/types/common';
import { makeTryAsync } from '../../platform/effect/try-async';
import {
  TenantQuery,
  type TenantScope,
} from '../../platform/tenancy/tenant-query';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { makeTenantCrud } from '../../platform/db/tenant-crud';
import { executeRows } from '../../platform/db/execute-rows';
import {
  orders,
  orderItems,
  clients,
  products,
} from '../../platform/db/schema';
import { OrdersInfrastructureError } from './orders.errors';

type OrderQueryDto = Schema.Schema.Type<typeof OrderQuerySchema>;
type CreateOrderItemInput = Omit<typeof orderItems.$inferInsert, 'order_id'>;
export type DeleteDraftOrderResult = 'deleted' | 'not_found' | 'not_draft';

const OrderNumberSequenceRowSchema = Schema.Struct({
  value: Schema.NumberFromString,
});

const tryAsync = makeTryAsync(
  (action, cause) =>
    new OrdersInfrastructureError({
      action,
      cause,
      messageKey: 'orders.infrastructureFailed',
    }),
);

export class OrdersRepository extends Effect.Service<OrdersRepository>()(
  '@stocket/effect/orders/OrdersRepository',
  {
    effect: makeTenantCrud(orders, {
      entity: 'order',
      onError: (action, cause) =>
        new OrdersInfrastructureError({
          action,
          cause,
          messageKey: 'orders.infrastructureFailed',
        }),
      extras: ({
        db,
        tryAsync,
        scopedWhere,
        scopedWhereId,
        tenantScope,
        insertValues,
        withTransaction,
      }) => {
        const buildOrderFilters = (query: OrderQueryDto): SQL[] => {
          const conditions: SQL[] = [];
          if (query.client_id) {
            conditions.push(eq(orders.client_id, query.client_id));
          }
          if (query.status) {
            conditions.push(eq(orders.status, query.status));
          }
          if (query.date_from) {
            conditions.push(gte(orders.created_at, new Date(query.date_from)));
          }
          if (query.date_to) {
            conditions.push(lte(orders.created_at, new Date(query.date_to)));
          }
          if (query.q) {
            conditions.push(
              or(
                ilike(orders.order_number, `%${query.q}%`),
                ilike(clients.company_name, `%${query.q}%`),
              )!,
            );
          }
          return conditions;
        };

        const findAllPaginatedWithRelations = (query: OrderQueryDto) =>
          Effect.gen(function* () {
            const where = yield* scopedWhere(...buildOrderFilters(query));
            const scope = yield* tenantScope;
            return yield* tryAsync('list orders paginated', async () => {
              const { page, limit, skip } = resolvePaginationWindow(
                query.page,
                query.limit,
              );

              const distinctCount = sql<number>`count(DISTINCT ${orders.id})::int`;
              const totalCount = sql<number>`count(*)::int`;
              const countQuery = query.q
                ? db
                    .select({ count: distinctCount })
                    .from(orders)
                    .leftJoin(
                      clients,
                      and(
                        eq(orders.client_id, clients.id),
                        scope.tenantPredicate(clients),
                      ),
                    )
                    .where(where)
                : db.select({ count: totalCount }).from(orders).where(where);

              const [countResult] = await countQuery;
              const orderRows = await db
                .select()
                .from(orders)
                .leftJoin(
                  clients,
                  and(
                    eq(orders.client_id, clients.id),
                    scope.tenantPredicate(clients),
                  ),
                )
                .where(where)
                .orderBy(desc(orders.created_at))
                .offset(skip)
                .limit(limit);

              const orderIds = orderRows.map((row) => row.orders.id);
              const itemsByOrderId: Record<
                string,
                (typeof orderItems.$inferSelect)[]
              > = {};
              if (orderIds.length > 0) {
                const allItems = await db
                  .select()
                  .from(orderItems)
                  .where(inArray(orderItems.order_id, orderIds));
                for (const item of allItems) {
                  (itemsByOrderId[item.order_id] ??= []).push(item);
                }
              }

              return toRepositoryPaginatedResult(
                orderRows.map((row) => ({
                  ...row.orders,
                  client: row.clients,
                  items: itemsByOrderId[row.orders.id] ?? [],
                })),
                countResult?.count ?? 0,
                page,
                limit,
              );
            });
          });

        const findByIdWithRelations = (id: string) =>
          Effect.gen(function* () {
            const where = yield* scopedWhereId(id);
            const scope = yield* tenantScope;
            return yield* tryAsync('find order by id', async () => {
              const rows = await db
                .select()
                .from(orders)
                .leftJoin(
                  clients,
                  and(
                    eq(orders.client_id, clients.id),
                    scope.tenantPredicate(clients),
                  ),
                )
                .where(where)
                .limit(1);

              if (!rows[0]) return null;

              const items = await db
                .select({
                  item: orderItems,
                  product: products,
                })
                .from(orderItems)
                .leftJoin(
                  products,
                  and(
                    eq(orderItems.product_id, products.id),
                    scope.tenantPredicate(products),
                  ),
                )
                .where(eq(orderItems.order_id, id));

              return {
                ...rows[0].orders,
                client: rows[0].clients,
                items: items.map((item) => ({
                  ...item.item,
                  product: item.product,
                })),
              };
            });
          });

        const createWithItems = (
          data: typeof orders.$inferInsert,
          items: ReadonlyArray<CreateOrderItemInput>,
        ) =>
          Effect.gen(function* () {
            const values = yield* insertValues(data);
            const scope = yield* tenantScope;
            return yield* withTransaction('create order with items', async (tx) => {
              const [order] = await tx.insert(orders).values(values).returning();

              if (!order) {
                throw new Error('Order insert returned no row');
              }

              if (items.length === 0) {
                return order;
              }

              const productIds = [
                ...new Set(items.map((item) => item.product_id)),
              ];
              const tenantProducts = await tx
                .select({ id: products.id })
                .from(products)
                .where(scope.whereTenantIds(products, productIds));

              if (tenantProducts.length !== productIds.length) {
                throw new Error(
                  'Order item references a product outside tenant',
                );
              }

              await tx.insert(orderItems).values(
                items.map((item) => ({
                  ...item,
                  order_id: order.id,
                })),
              );

              return order;
            });
          });

        const deleteDraftWithItems = (id: string) =>
          Effect.gen(function* () {
            const scope = yield* tenantScope;
            return yield* withTransaction(
              'delete draft order with items',
              async (tx): Promise<DeleteDraftOrderResult> => {
                const [order] = await tx
                  .select({ status: orders.status })
                  .from(orders)
                  .where(scope.whereTenantId(orders, id))
                  .for('update')
                  .limit(1);

                if (!order) {
                  return 'not_found';
                }

                if (order.status !== OrderStatus.DRAFT) {
                  return 'not_draft';
                }

                await tx.delete(orderItems).where(eq(orderItems.order_id, id));

                const deleted = await tx
                  .delete(orders)
                  .where(
                    scope.whereTenantId(
                      orders,
                      id,
                      eq(orders.status, OrderStatus.DRAFT),
                    ),
                  )
                  .returning({ id: orders.id });

                return deleted.length > 0 ? 'deleted' : 'not_draft';
              },
            );
          });

        const getNextOrderNumberSequence = () =>
          tryAsync('get next order number', async () => {
            const rows = await executeRows(
              db,
              sql`SELECT nextval('order_number_seq')::bigint AS value`,
              OrderNumberSequenceRowSchema,
            );
            return rows[0]?.value ?? 0;
          });

        return {
          findAllPaginatedWithRelations,
          findByIdWithRelations,
          createWithItems,
          deleteDraftWithItems,
          getNextOrderNumberSequence,
        };
      },
    }),
    dependencies: [TenantQuery.Default],
  },
) {}

export class OrderItemsRepository extends Effect.Service<OrderItemsRepository>()(
  '@stocket/effect/orders/OrderItemsRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;
      const currentTenantScope = Effect.map(tenantQuery.tenantId, (tenantId) =>
        tenantQuery.forTenant(tenantId),
      );
      const orderItemTenantFilter = (tenantScope: TenantScope) =>
        sql`${orderItems.order_id} IN (SELECT id FROM orders WHERE ${tenantScope.whereTenant(orders)})`;

      const findByIds = (ids: string[]) =>
        Effect.gen(function* () {
          if (ids.length === 0) return [];

          const tenantScope = yield* currentTenantScope;
          return yield* tryAsync('find order items by ids', async () => {
            const rows = await db
              .select()
              .from(orderItems)
              .where(
                and(
                  inArray(orderItems.id, ids),
                  orderItemTenantFilter(tenantScope),
                ),
              )
              .limit(ids.length);

            if (!rows[0]) return null;

            return rows;
          });
        });

      const findByOrderId = (orderId: string) =>
        Effect.gen(function* () {
          const tenantScope = yield* currentTenantScope;
          return yield* tryAsync('find order items by order id', async () => {
            const items = await db
              .select({
                item: orderItems,
                product: products,
              })
              .from(orderItems)
              .leftJoin(
                products,
                and(
                  eq(orderItems.product_id, products.id),
                  tenantScope.tenantPredicate(products),
                ),
              )
              .where(
                and(
                  eq(orderItems.order_id, orderId),
                  orderItemTenantFilter(tenantScope),
                ),
              );

            return items.map((i) => ({ ...i.item, product: i.product }));
          });
        });

      const createMany = (items: (typeof orderItems.$inferInsert)[]) =>
        Effect.gen(function* () {
          const tenantScope = yield* currentTenantScope;
          return yield* tryAsync('create order items', async () => {
            if (items.length === 0) return [];

            const orderIds = [...new Set(items.map((item) => item.order_id))];
            const tenantOrders = await db
              .select({ id: orders.id })
              .from(orders)
              .where(tenantScope.whereTenantIds(orders, orderIds));

            if (tenantOrders.length !== orderIds.length) {
              throw new Error('Order item references an order outside tenant');
            }

            const productIds = [
              ...new Set(items.map((item) => item.product_id)),
            ];
            const tenantProducts = await db
              .select({ id: products.id })
              .from(products)
              .where(tenantScope.whereTenantIds(products, productIds));

            if (tenantProducts.length !== productIds.length) {
              throw new Error('Order item references a product outside tenant');
            }

            return db.insert(orderItems).values(items).returning();
          });
        });

      const incrementPicked = (orderItemId: string, quantity: number) =>
        Effect.gen(function* () {
          const tenantScope = yield* currentTenantScope;
          return yield* tryAsync(
            'increment order item quantity_picked',
            async () => {
              const rows = await db
                .update(orderItems)
                .set({
                  quantity_picked: sql`${orderItems.quantity_picked} + ${quantity}`,
                  updated_at: new Date(),
                })
                .where(
                  and(
                    eq(orderItems.id, orderItemId),
                    sql`${orderItems.quantity_picked} + ${quantity} <= ${orderItems.quantity}`,
                    orderItemTenantFilter(tenantScope),
                  ),
                )
                .returning({ id: orderItems.id });
              return rows.length;
            },
          );
        });

      const deleteByOrderId = (orderId: string) =>
        Effect.gen(function* () {
          const tenantScope = yield* currentTenantScope;
          return yield* tryAsync('delete order items by order id', () =>
            db
              .delete(orderItems)
              .where(
                and(
                  eq(orderItems.order_id, orderId),
                  orderItemTenantFilter(tenantScope),
                ),
              ),
          );
        });

      return {
        findByIds,
        findByOrderId,
        createMany,
        incrementPicked,
        deleteByOrderId,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
