import { Effect } from 'effect';
import type { Schema } from 'effect';
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
import { type OrderQuerySchema } from '@stocket/types/orders';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
} from '@stocket/types/common';
import { makeTryAsync } from '../../platform/effect/try-async';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import {
  orders,
  orderItems,
  clients,
  products,
} from '../../platform/db/schema';
import { OrdersInfrastructureError } from './orders.errors';

type OrderQueryDto = Schema.Schema.Type<typeof OrderQuerySchema>;

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
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;

      const findAllPaginated = (query: OrderQueryDto) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('list orders paginated', async () => {
            const { page, limit, skip } = resolvePaginationWindow(
              query.page,
              query.limit,
            );

            const conditions: SQL[] = [eq(orders.tenant_id, tenantId)];
            if (query.client_id) {
              conditions.push(eq(orders.client_id, query.client_id));
            }
            if (query.status) {
              conditions.push(eq(orders.status, query.status));
            }
            if (query.date_from) {
              conditions.push(
                gte(orders.created_at, new Date(query.date_from)),
              );
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

            const where = and(...conditions);

            // Count query — join clients only if q filter needs it
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
                      eq(orders.tenant_id, clients.tenant_id),
                    ),
                  )
                  .where(where)
              : db.select({ count: totalCount }).from(orders).where(where);

            const [countResult] = await countQuery;
            const total = countResult?.count ?? 0;

            // Data query with relations
            const orderRows = await db
              .select()
              .from(orders)
              .leftJoin(
                clients,
                and(
                  eq(orders.client_id, clients.id),
                  eq(orders.tenant_id, clients.tenant_id),
                ),
              )
              .where(where)
              .orderBy(desc(orders.created_at))
              .offset(skip)
              .limit(limit);

            const orderIds = orderRows.map((r) => r.orders.id);
            const itemsByOrderId: Record<
              string,
              (typeof orderItems.$inferSelect)[]
            > = {};
            if (orderIds.length > 0) {
              const allItems = await db
                .select()
                .from(orderItems)
                .where(sql`${orderItems.order_id} IN ${orderIds}`);
              for (const item of allItems) {
                (itemsByOrderId[item.order_id] ??= []).push(item);
              }
            }

            const data = orderRows.map((r) => ({
              ...r.orders,
              client: r.clients,
              items: itemsByOrderId[r.orders.id] ?? [],
            }));

            return toRepositoryPaginatedResult(data, total, page, limit);
          });
        });

      const findById = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('find order by id', async () => {
            const rows = await db
              .select()
              .from(orders)
              .leftJoin(
                clients,
                and(
                  eq(orders.client_id, clients.id),
                  eq(orders.tenant_id, clients.tenant_id),
                ),
              )
              .where(and(eq(orders.tenant_id, tenantId), eq(orders.id, id)))
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
                  eq(products.tenant_id, tenantId),
                ),
              )
              .where(eq(orderItems.order_id, id));

            return {
              ...rows[0].orders,
              client: rows[0].clients,
              items: items.map((i) => ({ ...i.item, product: i.product })),
            };
          });
        });

      const create = (data: typeof orders.$inferInsert) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('create order', async () => {
            const rows = await db
              .insert(orders)
              .values({ ...data, tenant_id: tenantId })
              .returning();
            return rows[0]!;
          });
        });

      const update = (id: string, data: Partial<typeof orders.$inferInsert>) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('update order', async () => {
            const { tenant_id: _tenantId, ...updateData } = data;
            const rows = await db
              .update(orders)
              .set({ ...updateData, updated_at: new Date() })
              .where(and(eq(orders.tenant_id, tenantId), eq(orders.id, id)))
              .returning({ id: orders.id });
            return rows.length;
          });
        });

      const remove = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('delete order', () =>
            db
              .delete(orders)
              .where(and(eq(orders.tenant_id, tenantId), eq(orders.id, id))),
          );
        });

      const getNextOrderNumberSequence = () =>
        tryAsync('get next order number', async () => {
          const result = await db.execute(
            sql`SELECT nextval('order_number_seq')::bigint AS value`,
          );
          const rows =
            (result as unknown as { rows: { value: unknown }[] }).rows ??
            (result as unknown as { value: unknown }[]);
          return Number(rows[0]?.value);
        });

      const existsById = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('check order existence', async () => {
            const rows = await db
              .select({ id: orders.id })
              .from(orders)
              .where(and(eq(orders.tenant_id, tenantId), eq(orders.id, id)))
              .limit(1);
            return rows.length > 0;
          });
        });

      return {
        findAllPaginated,
        findById,
        create,
        update,
        delete: remove,
        getNextOrderNumberSequence,
        existsById,
      };
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
      const orderItemTenantFilter = (tenantId: string) =>
        sql`${orderItems.order_id} IN (SELECT id FROM orders WHERE tenant_id = ${tenantId})`;

      const findByIds = (ids: string[]) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('find order items by ids', async () => {
            const rows = await db
              .select()
              .from(orderItems)
              .where(
                and(
                  sql`${orderItems.id} IN ${ids}`,
                  orderItemTenantFilter(tenantId),
                ),
              )
              .limit(ids.length);

            if (!rows[0]) return null;

            return rows;
          });
        });

      const findByOrderId = (orderId: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
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
                  eq(products.tenant_id, tenantId),
                ),
              )
              .where(
                and(
                  eq(orderItems.order_id, orderId),
                  orderItemTenantFilter(tenantId),
                ),
              );

            return items.map((i) => ({ ...i.item, product: i.product }));
          });
        });

      const createMany = (items: (typeof orderItems.$inferInsert)[]) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('create order items', async () => {
            if (items.length === 0) return [];

            const orderIds = [...new Set(items.map((item) => item.order_id))];
            const tenantOrders = await db
              .select({ id: orders.id })
              .from(orders)
              .where(
                and(
                  eq(orders.tenant_id, tenantId),
                  inArray(orders.id, orderIds),
                ),
              );

            if (tenantOrders.length !== orderIds.length) {
              throw new Error('Order item references an order outside tenant');
            }

            const productIds = [
              ...new Set(items.map((item) => item.product_id)),
            ];
            const tenantProducts = await db
              .select({ id: products.id })
              .from(products)
              .where(
                and(
                  eq(products.tenant_id, tenantId),
                  inArray(products.id, productIds),
                ),
              );

            if (tenantProducts.length !== productIds.length) {
              throw new Error('Order item references a product outside tenant');
            }

            return db.insert(orderItems).values(items).returning();
          });
        });

      const incrementPicked = (orderItemId: string, quantity: number) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
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
                    orderItemTenantFilter(tenantId),
                  ),
                )
                .returning({ id: orderItems.id });
              return rows.length;
            },
          );
        });

      const deleteByOrderId = (orderId: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('delete order items by order id', () =>
            db
              .delete(orderItems)
              .where(
                and(
                  eq(orderItems.order_id, orderId),
                  orderItemTenantFilter(tenantId),
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
