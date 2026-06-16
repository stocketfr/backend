import { Effect } from 'effect';
import { eq, and, asc, isNull, sql, type SQL } from 'drizzle-orm';
import type {
  CreateAreaDto,
  UpdateAreaDto,
  AreaQueryDto,
} from '@stocket/types/areas';
import { makeTryAsync } from '../../platform/effect/try-async';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
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

      const loadChildrenRecursively = async (
        area: AreaWithChildren,
        tenantId: string,
      ): Promise<void> => {
        const children = await db
          .select()
          .from(areas)
          .where(
            and(
              eq(areas.tenant_id, tenantId),
              eq(areas.parent_id, area.id),
              eq(areas.location_id, area.location_id),
            ),
          )
          .orderBy(asc(areas.name));

        area.children = children;

        for (const child of children) {
          await loadChildrenRecursively(child, tenantId);
        }
      };

      const validateAreaReferences = (
        tenantId: string,
        dto: { location_id?: string; parent_id?: string | null },
        currentLocationId?: string,
      ) =>
        Effect.gen(function* () {
          const effectiveLocationId = dto.location_id ?? currentLocationId;

          if (dto.location_id) {
            const locationRows = yield* tryAsync(
              'validate area location',
              async () =>
                db
                  .select({ id: locations.id })
                  .from(locations)
                  .where(
                    and(
                      eq(locations.tenant_id, tenantId),
                      eq(locations.id, dto.location_id!),
                    ),
                  )
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
            const parentRows = yield* tryAsync(
              'validate parent area',
              async () =>
                db
                  .select({ id: areas.id, location_id: areas.location_id })
                  .from(areas)
                  .where(
                    and(
                      eq(areas.tenant_id, tenantId),
                      eq(areas.id, dto.parent_id!),
                    ),
                  )
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
          const tenantId = yield* tenantQuery.tenantId;
          yield* validateAreaReferences(tenantId, dto);
          return yield* tryAsync('create area', async () => {
            const rows = await db
              .insert(areas)
              .values({
                ...dto,
                tenant_id: tenantId,
                parent_id: dto.parent_id ?? null,
                code: dto.code ?? '',
                description: dto.description ?? '',
                is_active: dto.is_active ?? true,
              })
              .returning();
            return rows[0]!;
          });
        });

      const findAll = (query: AreaQueryDto) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('list areas', async () => {
            const conditions: SQL[] = [eq(areas.tenant_id, tenantId)];

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

            return db
              .select()
              .from(areas)
              .where(and(...conditions))
              .orderBy(asc(areas.name));
          });
        });

      const findById = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('load area', async () => {
            const rows = await db
              .select({
                area: areas,
                location: locations,
              })
              .from(areas)
              .leftJoin(
                locations,
                and(
                  eq(areas.location_id, locations.id),
                  eq(locations.tenant_id, tenantId),
                ),
              )
              .where(and(eq(areas.tenant_id, tenantId), eq(areas.id, id)))
              .limit(1);

            if (!rows[0]) return null;
            return { ...rows[0].area, location: rows[0].location };
          });
        });

      const findByIdWithChildren = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('load area with children', async () => {
            const rows = await db
              .select({
                area: areas,
                location: locations,
              })
              .from(areas)
              .leftJoin(
                locations,
                and(
                  eq(areas.location_id, locations.id),
                  eq(locations.tenant_id, tenantId),
                ),
              )
              .where(and(eq(areas.tenant_id, tenantId), eq(areas.id, id)))
              .limit(1);

            if (!rows[0]) return null;

            const children = await db
              .select()
              .from(areas)
              .where(
                and(
                  eq(areas.tenant_id, tenantId),
                  eq(areas.parent_id, id),
                  eq(areas.location_id, rows[0].area.location_id),
                ),
              );

            return { ...rows[0].area, location: rows[0].location, children };
          });
        });

      const findHierarchyByLocationId = (locationId: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('load area hierarchy', async () => {
            const rootAreas: AreaWithChildren[] = await db
              .select()
              .from(areas)
              .where(
                and(
                  eq(areas.tenant_id, tenantId),
                  eq(areas.location_id, locationId),
                  isNull(areas.parent_id),
                ),
              )
              .orderBy(asc(areas.name));

            for (const area of rootAreas) {
              await loadChildrenRecursively(area, tenantId);
            }

            return rootAreas;
          });
        });

      const update = (id: string, dto: UpdateAreaDto) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
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
                  and(
                    eq(areas.location_id, locations.id),
                    eq(locations.tenant_id, tenantId),
                  ),
                )
                .where(and(eq(areas.tenant_id, tenantId), eq(areas.id, id)))
                .limit(1),
          );

          if (!existing[0]) return null;

          yield* validateAreaReferences(
            tenantId,
            dto,
            existing[0].area.location_id,
          );

          return yield* tryAsync('update area', async () => {
            await db
              .update(areas)
              .set({ ...dto, updated_at: new Date() })
              .where(and(eq(areas.tenant_id, tenantId), eq(areas.id, id)));

            const updated = await db
              .select({
                area: areas,
                location: locations,
              })
              .from(areas)
              .leftJoin(
                locations,
                and(
                  eq(areas.location_id, locations.id),
                  eq(locations.tenant_id, tenantId),
                ),
              )
              .where(and(eq(areas.tenant_id, tenantId), eq(areas.id, id)))
              .limit(1);

            return updated[0]
              ? { ...updated[0].area, location: updated[0].location }
              : null;
          });
        });

      const remove = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('delete area', async () => {
            const result = await db
              .delete(areas)
              .where(and(eq(areas.tenant_id, tenantId), eq(areas.id, id)))
              .returning({ id: areas.id });
            return result.length > 0;
          });
        });

      const existsById = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('check area existence', async () => {
            const rows = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(areas)
              .where(and(eq(areas.tenant_id, tenantId), eq(areas.id, id)));
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
