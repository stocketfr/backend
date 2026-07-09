import { Effect } from 'effect';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { makeTryAsync } from '../../platform/effect/try-async';
import {
  TenantQuery,
  type TenantScope,
} from '../../platform/tenancy/tenant-query';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { orderItems, orders, products } from '../../platform/db/schema';
import { OrdersInfrastructureError } from './orders.errors';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new OrdersInfrastructureError({
      action,
      cause,
      messageKey: 'orders.infrastructureFailed',
    }),
);

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
