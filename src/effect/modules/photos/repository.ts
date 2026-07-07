import { Effect } from 'effect';
import { eq, asc, sql, and } from 'drizzle-orm';
import { makeTryAsync } from '../../platform/effect/try-async';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
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
      const tenantOwnsProduct = (tenantId: string) =>
        sql`${photos.product_id} IN (SELECT id FROM products WHERE tenant_id = ${tenantId})`;
      const ensureTenantOwnsProduct = async (
        tenantId: string,
        productId: string,
      ) => {
        const productRows = await db
          .select({ id: products.id })
          .from(products)
          .where(
            and(eq(products.tenant_id, tenantId), eq(products.id, productId)),
          )
          .limit(1);
        if (productRows.length === 0) {
          throw new Error('Photo product does not belong to tenant');
        }
      };

      const findByProductId = (productId: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('list photos by product', () =>
            db
              .select()
              .from(photos)
              .where(
                and(
                  eq(photos.product_id, productId),
                  tenantOwnsProduct(tenantId),
                ),
              )
              .orderBy(asc(photos.display_order), asc(photos.created_at)),
          );
        });

      const findById = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('load photo', async () => {
            const rows = await db
              .select()
              .from(photos)
              .where(and(eq(photos.id, id), tenantOwnsProduct(tenantId)))
              .limit(1);
            return rows[0] ?? null;
          });
        });

      const findByProductSourceHash = (productId: string, sourceHash: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('load photo by source hash', async () => {
            const rows = await db
              .select()
              .from(photos)
              .where(
                and(
                  eq(photos.product_id, productId),
                  eq(photos.source_hash, sourceHash),
                  tenantOwnsProduct(tenantId),
                ),
              )
              .limit(1);
            return rows[0] ?? null;
          });
        });

      const create = (data: typeof photos.$inferInsert) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('create photo', async () => {
            await ensureTenantOwnsProduct(tenantId, data.product_id);

            const rows = await db.insert(photos).values(data).returning();
            return rows[0]!;
          });
        });

      const createIdempotent = (data: typeof photos.$inferInsert) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('create idempotent photo', async () => {
            await ensureTenantOwnsProduct(tenantId, data.product_id);
            const rows = await db
              .insert(photos)
              .values(data)
              .onConflictDoNothing()
              .returning();
            const inserted = rows[0];
            if (inserted) return { photo: inserted, created: true };

            if (!data.source_hash) {
              throw new Error('Photo insert conflicted without source hash');
            }

            const existing = await db
              .select()
              .from(photos)
              .where(
                and(
                  eq(photos.product_id, data.product_id),
                  eq(photos.source_hash, data.source_hash),
                  tenantOwnsProduct(tenantId),
                ),
              )
              .limit(1);

            if (!existing[0]) {
              throw new Error(
                'Photo insert conflicted but existing photo was not found',
              );
            }

            return { photo: existing[0], created: false };
          });
        });

      const remove = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('delete photo metadata', async () => {
            await db
              .delete(photos)
              .where(and(eq(photos.id, id), tenantOwnsProduct(tenantId)));
          });
        });

      const countByProductId = (productId: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('count photos by product', async () => {
            const rows = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(photos)
              .where(
                and(
                  eq(photos.product_id, productId),
                  tenantOwnsProduct(tenantId),
                ),
              );
            return rows[0]?.count ?? 0;
          });
        });

      return {
        findByProductId,
        findById,
        findByProductSourceHash,
        create,
        createIdempotent,
        delete: remove,
        countByProductId,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
