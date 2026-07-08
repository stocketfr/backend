import { Effect } from 'effect';
import { eq, and, asc, isNull, sql, type SQL } from 'drizzle-orm';
import type {
  CreateAreaDto,
  UpdateAreaDto,
  AreaQueryDto,
} from '@stocket/types/areas';
import { makeTryAsync } from '../../platform/effect/try-async';
import {
  TenantQuery,
  type TenantScope,
} from '../../platform/tenancy/tenant-query';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { areas, locations } from '../../platform/db/schema';
import {
  AreaLocationNotFound,
  AreaParentLocationMismatch,
  AreasInfrastructureError,
  ParentAreaNotFound,
} from './areas.errors';

type AreaRow = typeof areas.$inferSelect;
type AreaWithChildren = AreaRow & { children?: AreaWithChildren[] };

const tryAsync = makeTryAsync(
  (action, cause) =>
    new AreasInfrastructureError({
      action,
      cause,
      messageKey: 'areas.repositoryFailed',
    }),
);

export class AreasRepository extends Effect.Service<AreasRepository>()(
  '@stocket/effect/areas/AreasRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;
      const currentTenantScope = Effect.map(tenantQuery.tenantId, (tenantId) =>
        tenantQuery.forTenant(tenantId),
      );
      const tenantLocationJoin = (tenantScope: TenantScope) =>
        and(
          eq(areas.location_id, locations.id),
          tenantScope.tenantPredicate(locations),
        );

      const loadChildrenRecursively = (
        area: AreaWithChildren,
      ): Effect.Effect<
        void,
        AreasInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            areas,
            eq(areas.parent_id, area.id),
            eq(areas.location_id, area.location_id),
          );
          const children = yield* tryAsync('load child areas', () =>
            db.select().from(areas).where(where).orderBy(asc(areas.name)),
          );

          area.children = children;

          yield* Effect.forEach(children, loadChildrenRecursively, {
            discard: true,
          });
        });

      const validateAreaReferences = (
        dto: { location_id?: string; parent_id?: string | null },
        currentLocationId?: string,
      ) =>
        Effect.gen(function* () {
          const effectiveLocationId = dto.location_id ?? currentLocationId;

          if (dto.location_id) {
            const where = yield* tenantQuery.whereTenantId(
              locations,
              dto.location_id,
            );
            const locationRows = yield* tryAsync(
              'validate area location',
              async () =>
                db
                  .select({ id: locations.id })
                  .from(locations)
                  .where(where)
                  .limit(1),
            );
            if (locationRows.length === 0) {
              return yield* Effect.fail(
                new AreaLocationNotFound({
                  locationId: dto.location_id,
                  messageKey: 'areas.locationNotFound',
                }),
              );
            }
          }

          if (dto.parent_id) {
            const where = yield* tenantQuery.whereTenantId(
              areas,
              dto.parent_id,
            );
            const parentRows = yield* tryAsync(
              'validate parent area',
              async () =>
                db
                  .select({ id: areas.id, location_id: areas.location_id })
                  .from(areas)
                  .where(where)
                  .limit(1),
            );
            const parent = parentRows[0];
            if (!parent) {
              return yield* Effect.fail(
                new ParentAreaNotFound({
                  parentId: dto.parent_id,
                  messageKey: 'areas.parentNotFound',
                }),
              );
            }
            if (
              effectiveLocationId !== undefined &&
              parent.location_id !== effectiveLocationId
            ) {
              return yield* Effect.fail(
                new AreaParentLocationMismatch({
                  parentId: dto.parent_id,
                  locationId: effectiveLocationId,
                  messageKey: 'areas.parentLocationMismatch',
                }),
              );
            }
          }
        });

      const create = (dto: CreateAreaDto) =>
        Effect.gen(function* () {
          yield* validateAreaReferences(dto);
          const values = yield* tenantQuery.insertValues({
            ...dto,
            parent_id: dto.parent_id ?? null,
            code: dto.code ?? '',
            description: dto.description ?? '',
            is_active: dto.is_active ?? true,
          });
          return yield* tryAsync('create area', async () => {
            const rows = await db
              .insert(areas)
              .values(values)
              .returning();
            return rows[0]!;
          });
        });

      const findAll = (query: AreaQueryDto) =>
        Effect.gen(function* () {
          const conditions: SQL[] = [];

          if (query.location_id) {
            conditions.push(eq(areas.location_id, query.location_id));
          }
          if (query.parent_id) {
            conditions.push(eq(areas.parent_id, query.parent_id));
          }
          if (query.root_only) {
            conditions.push(isNull(areas.parent_id));
          }
          if (query.is_active !== undefined) {
            conditions.push(eq(areas.is_active, query.is_active));
          }

          const where = yield* tenantQuery.whereTenant(areas, ...conditions);
          return yield* tryAsync('list areas', async () => {
            return db
              .select()
              .from(areas)
              .where(where)
              .orderBy(asc(areas.name));
          });
        });

      const findById = (id: string) =>
        Effect.gen(function* () {
          const tenantScope = yield* currentTenantScope;
          const where = tenantScope.whereTenantId(areas, id);
          return yield* tryAsync('load area', async () => {
            const rows = await db
              .select({
                area: areas,
                location: locations,
              })
              .from(areas)
              .leftJoin(
                locations,
                tenantLocationJoin(tenantScope),
              )
              .where(where)
              .limit(1);

            if (!rows[0]) return null;
            return { ...rows[0].area, location: rows[0].location };
          });
        });

      const findByIdWithChildren = (id: string) =>
        Effect.gen(function* () {
          const tenantScope = yield* currentTenantScope;
          const where = tenantScope.whereTenantId(areas, id);
          const rows = yield* tryAsync('load area with children', async () =>
            db
              .select({
                area: areas,
                location: locations,
              })
              .from(areas)
              .leftJoin(
                locations,
                tenantLocationJoin(tenantScope),
              )
              .where(where)
              .limit(1),
          );

          if (!rows[0]) return null;

          const childrenWhere = tenantScope.whereTenant(
            areas,
            eq(areas.parent_id, id),
            eq(areas.location_id, rows[0].area.location_id),
          );
          const children = yield* tryAsync('load child areas', () =>
            db.select().from(areas).where(childrenWhere),
          );

          return { ...rows[0].area, location: rows[0].location, children };
        });

      const findHierarchyByLocationId = (locationId: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenant(
            areas,
            eq(areas.location_id, locationId),
            isNull(areas.parent_id),
          );
          const rootAreas: AreaWithChildren[] = yield* tryAsync(
            'load area hierarchy',
            async () =>
              db
                .select()
                .from(areas)
                .where(where)
                .orderBy(asc(areas.name)),
          );

          yield* Effect.forEach(rootAreas, loadChildrenRecursively, {
            discard: true,
          });

          return rootAreas;
        });

      const update = (id: string, dto: UpdateAreaDto) =>
        Effect.gen(function* () {
          const tenantScope = yield* currentTenantScope;
          const where = tenantScope.whereTenantId(areas, id);
          const existing = yield* tryAsync(
            'load area before update',
            async () =>
              db
                .select({
                  area: areas,
                  location: locations,
                })
                .from(areas)
                .leftJoin(
                  locations,
                  tenantLocationJoin(tenantScope),
                )
                .where(where)
                .limit(1),
          );

          if (!existing[0]) return null;

          yield* validateAreaReferences(
            dto,
            existing[0].area.location_id,
          );

          return yield* tryAsync('update area', async () => {
            await db
              .update(areas)
              .set({ ...dto, updated_at: new Date() })
              .where(where);

            const updated = await db
              .select({
                area: areas,
                location: locations,
              })
              .from(areas)
              .leftJoin(
                locations,
                tenantLocationJoin(tenantScope),
              )
              .where(where)
              .limit(1);

            return updated[0]
              ? { ...updated[0].area, location: updated[0].location }
              : null;
          });
        });

      const remove = (id: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(areas, id);
          return yield* tryAsync('delete area', async () => {
            const result = await db
              .delete(areas)
              .where(where)
              .returning({ id: areas.id });
            return result.length > 0;
          });
        });

      const existsById = (id: string) =>
        Effect.gen(function* () {
          const where = yield* tenantQuery.whereTenantId(areas, id);
          return yield* tryAsync('check area existence', async () => {
            const rows = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(areas)
              .where(where);
            return (rows[0]?.count ?? 0) > 0;
          });
        });

      return {
        create,
        findAll,
        findById,
        findByIdWithChildren,
        findHierarchyByLocationId,
        update,
        delete: remove,
        existsById,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
