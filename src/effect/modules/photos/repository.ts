import { Effect } from 'effect';
import { eq, asc, sql, and } from 'drizzle-orm';
import { makeTryAsync } from '../../platform/effect/try-async';
import {
  TenantQuery,
  type TenantScope,
} from '../../platform/tenancy/tenant-query';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { photos, products } from '../../platform/db/schema';
import { PhotosInfrastructureError } from './photos.errors';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new PhotosInfrastructureError({
      action,
      cause,
      messageKey: 'photos.repositoryFailed',
    }),
);

export class PhotosRepository extends Effect.Service<PhotosRepository>()(
  '@stocket/effect/photos/PhotosRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;
      const currentTenantScope = Effect.map(tenantQuery.tenantId, (tenantId) =>
        tenantQuery.forTenant(tenantId),
      );
      const tenantOwnsProduct = (tenantScope: TenantScope) =>
        sql`${photos.product_id} IN (SELECT id FROM products WHERE ${tenantScope.whereTenant(products)})`;

      const findByProductId = (productId: string) =>
        Effect.gen(function* () {
          const tenantScope = yield* currentTenantScope;
          return yield* tryAsync('list photos by product', () =>
            db
              .select()
              .from(photos)
              .where(
                and(
                  eq(photos.product_id, productId),
                  tenantOwnsProduct(tenantScope),
                ),
              )
              .orderBy(asc(photos.display_order), asc(photos.created_at)),
          );
        });

      const findById = (id: string) =>
        Effect.gen(function* () {
          const tenantScope = yield* currentTenantScope;
          return yield* tryAsync('load photo', async () => {
            const rows = await db
              .select()
              .from(photos)
              .where(and(eq(photos.id, id), tenantOwnsProduct(tenantScope)))
              .limit(1);
            return rows[0] ?? null;
          });
        });

      const create = (data: typeof photos.$inferInsert) =>
        Effect.gen(function* () {
          const tenantScope = yield* currentTenantScope;
          return yield* tryAsync('create photo', async () => {
            const productRows = await db
              .select({ id: products.id })
              .from(products)
              .where(tenantScope.whereTenantId(products, data.product_id))
              .limit(1);
            if (productRows.length === 0) {
              throw new Error('Photo product does not belong to tenant');
            }

            const rows = await db.insert(photos).values(data).returning();
            return rows[0]!;
          });
        });

      const remove = (id: string) =>
        Effect.gen(function* () {
          const tenantScope = yield* currentTenantScope;
          return yield* tryAsync('delete photo metadata', async () => {
            await db
              .delete(photos)
              .where(and(eq(photos.id, id), tenantOwnsProduct(tenantScope)));
          });
        });

      const countByProductId = (productId: string) =>
        Effect.gen(function* () {
          const tenantScope = yield* currentTenantScope;
          return yield* tryAsync('count photos by product', async () => {
            const rows = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(photos)
              .where(
                and(
                  eq(photos.product_id, productId),
                  tenantOwnsProduct(tenantScope),
                ),
              );
            return rows[0]?.count ?? 0;
          });
        });

      return {
        findByProductId,
        findById,
        create,
        delete: remove,
        countByProductId,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
