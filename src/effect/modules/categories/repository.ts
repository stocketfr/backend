import { Effect } from 'effect';
import { eq, asc, inArray, sql, type SQL } from 'drizzle-orm';
import { makeTenantCrud } from '../../platform/db/tenant-crud';
import { categories } from '../../platform/db/schema';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import { CategoriesInfrastructureError } from './categories.errors';

export class CategoriesRepository extends Effect.Service<CategoriesRepository>()(
  '@stocket/effect/categories/CategoriesRepository',
  {
    effect: makeTenantCrud(categories, {
      entity: 'category',
      onError: (action, cause) =>
        new CategoriesInfrastructureError({
          action,
          cause,
          messageKey: 'categories.repositoryFailed',
        }),
      extras: ({ db, tryAsync, scopedWhere }) => ({
        findAll: () =>
          Effect.gen(function* () {
            const where = yield* scopedWhere();
            return yield* tryAsync('list categories', () =>
              db
                .select()
                .from(categories)
                .where(where)
                .orderBy(asc(categories.name)),
            );
          }),

        existsByName: (name: string, parentId?: string | null) =>
          Effect.gen(function* () {
            const conditions: SQL[] = [eq(categories.name, name)];
            if (parentId != null) {
              conditions.push(eq(categories.parent_id, parentId));
            }
            const where = yield* scopedWhere(...conditions);
            return yield* tryAsync(
              'check category name uniqueness',
              async () => {
                const rows = await db
                  .select({ id: categories.id })
                  .from(categories)
                  .where(where)
                  .limit(1);
                return rows.length > 0;
              },
            );
          }),

        findOne: (conditions: {
          id?: string;
          name?: string;
          parent_id?: string | null;
        }) =>
          Effect.gen(function* () {
            const filterConditions: SQL[] = [];
            if (conditions.id) {
              filterConditions.push(eq(categories.id, conditions.id));
            }
            if (conditions.name) {
              filterConditions.push(eq(categories.name, conditions.name));
            }
            if (conditions.parent_id !== undefined) {
              if (conditions.parent_id === null) {
                filterConditions.push(sql`${categories.parent_id} IS NULL`);
              } else {
                filterConditions.push(
                  eq(categories.parent_id, conditions.parent_id),
                );
              }
            }
            const where = yield* scopedWhere(...filterConditions);
            return yield* tryAsync('load category', async () => {
              const rows = await db
                .select()
                .from(categories)
                .where(where)
                .limit(1);
              return rows[0] ?? null;
            });
          }),

        findAllDescendantIds: (parentId: string) =>
          Effect.gen(function* () {
            const visited = new Set([parentId]);
            const descendantIds: string[] = [];
            let parentIds = [parentId];

            while (parentIds.length > 0) {
              const where = yield* scopedWhere(
                inArray(categories.parent_id, parentIds),
              );
              const children = yield* tryAsync(
                'find descendant categories',
                () =>
                  db
                    .select({ id: categories.id })
                    .from(categories)
                    .where(where),
              );
              const nextParentIds: string[] = [];
              for (const child of children) {
                if (!visited.has(child.id)) {
                  visited.add(child.id);
                  descendantIds.push(child.id);
                  nextParentIds.push(child.id);
                }
              }
              parentIds = nextParentIds;
            }

            return descendantIds;
          }),
      }),
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
