import { Effect } from 'effect';
import type {
  AreaResponseDto,
  CreateAreaDto,
  UpdateAreaDto,
  AreaQueryDto,
} from '@stocket/types/areas';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import { LocationsService } from '../locations/service';
import type { areas } from '../../platform/db/schema';
import { toAreaResponseDto } from './areas.utils';
import {
  AreaCircularReference,
  AreaLocationNotFound,
  AreaNotFound,
  AreaParentLocationMismatch,
  type AreasInfrastructureError,
  AreaSelfParent,
  ParentAreaNotFound,
} from './areas.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { AreasRepository } from './repository';

type AreaRow = typeof areas.$inferSelect;
type Area = AreaRow & {
  children?: Area[];
};

export class AreasService extends Effect.Service<AreasService>()(
  '@stocket/effect/areas/AreasService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* AreasRepository;
      const locationsService = yield* LocationsService;

      const getAreaOrFail = makeGetOrFail(
        (id: string) => repository.findById(id),
        (id) => new AreaNotFound({ id, messageKey: 'areas.notFound' }),
      );

      const wouldCreateCircularReference = (
        areaId: string,
        newParentId: string,
      ): Effect.Effect<boolean, AreasInfrastructureError | TenantNotResolved> =>
        Effect.gen(function* () {
          let currentId: string | null = newParentId;

          while (currentId) {
            if (currentId === areaId) {
              return true;
            }
            const parent: Area | null = yield* repository.findById(currentId);
            currentId = parent?.parent_id ?? null;
          }

          return false;
        });

      const create = (dto: CreateAreaDto) =>
        Effect.gen(function* () {
          const locationExists = yield* locationsService.existsById(
            dto.location_id,
          );
          if (!locationExists) {
            return yield* Effect.fail(
              new AreaLocationNotFound({
                locationId: dto.location_id,
                messageKey: 'areas.locationNotFound',
              }),
            );
          }

          if (dto.parent_id) {
            const parentArea = yield* repository.findById(dto.parent_id);
            if (!parentArea) {
              return yield* Effect.fail(
                new ParentAreaNotFound({
                  parentId: dto.parent_id,
                  messageKey: 'areas.parentNotFound',
                }),
              );
            }
            if (parentArea.location_id !== dto.location_id) {
              return yield* Effect.fail(
                new AreaParentLocationMismatch({
                  parentId: dto.parent_id,
                  locationId: dto.location_id,
                  messageKey: 'areas.parentLocationMismatch',
                }),
              );
            }
          }

          const area = yield* repository.create(dto);
          return toAreaResponseDto(area);
        }).pipe(Effect.withSpan('AreasService.create'));

      const findAll = (
        query: AreaQueryDto,
      ): Effect.Effect<
        AreaResponseDto[],
        AreasInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const areas =
            query.include_children && query.location_id
              ? yield* repository.findHierarchyByLocationId(query.location_id)
              : yield* repository.findAll(query);
          return areas.map(toAreaResponseDto);
        }).pipe(Effect.withSpan('AreasService.findAll'));

      const findById = (
        id: string,
      ): Effect.Effect<
        AreaResponseDto,
        AreaNotFound | AreasInfrastructureError | TenantNotResolved
      > =>
        Effect.map(getAreaOrFail(id), toAreaResponseDto).pipe(
          Effect.withSpan('AreasService.findById', { attributes: { id } }),
        );

      const findByIdWithChildren = (
        id: string,
      ): Effect.Effect<
        AreaResponseDto,
        AreaNotFound | AreasInfrastructureError | TenantNotResolved
      > =>
        Effect.flatMap(repository.findByIdWithChildren(id), (area) =>
          area
            ? Effect.succeed(toAreaResponseDto(area))
            : Effect.fail(
                new AreaNotFound({
                  id,
                  messageKey: 'areas.notFound',
                }),
              ),
        ).pipe(Effect.withSpan('AreasService.findByIdWithChildren', { attributes: { id } }));

      const update = (
        id: string,
        dto: UpdateAreaDto,
      ): Effect.Effect<
        AreaResponseDto,
        | AreaCircularReference
        | AreaLocationNotFound
        | AreaNotFound
        | AreaParentLocationMismatch
        | AreasInfrastructureError
        | AreaSelfParent
        | ParentAreaNotFound
        | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const existingArea = yield* getAreaOrFail(id);

          if (dto.parent_id != null) {
            if (dto.parent_id === id) {
              return yield* Effect.fail(
                new AreaSelfParent({
                  id,
                  messageKey: 'areas.selfParent',
                }),
              );
            }

            const parentArea = yield* repository.findById(dto.parent_id);
            if (!parentArea) {
              return yield* Effect.fail(
                new ParentAreaNotFound({
                  parentId: dto.parent_id,
                  messageKey: 'areas.parentNotFound',
                }),
              );
            }
            if (parentArea.location_id !== existingArea.location_id) {
              return yield* Effect.fail(
                new AreaParentLocationMismatch({
                  parentId: dto.parent_id,
                  locationId: existingArea.location_id,
                  messageKey: 'areas.parentLocationMismatch',
                }),
              );
            }

            const circular = yield* wouldCreateCircularReference(
              id,
              dto.parent_id,
            );
            if (circular) {
              return yield* Effect.fail(
                new AreaCircularReference({
                  id,
                  parentId: dto.parent_id,
                  messageKey: 'areas.circularReference',
                }),
              );
            }
          }

          const updated = yield* repository.update(id, dto);
          if (!updated) {
            return yield* Effect.fail(
              new AreaNotFound({
                id,
                messageKey: 'areas.notFound',
              }),
            );
          }
          return toAreaResponseDto(updated);
        }).pipe(Effect.withSpan('AreasService.update', { attributes: { id } }));

      const remove = (
        id: string,
      ): Effect.Effect<
        void,
        AreaNotFound | AreasInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const deleted = yield* repository.delete(id);
          if (!deleted) {
            return yield* Effect.fail(
              new AreaNotFound({
                id,
                messageKey: 'areas.notFound',
              }),
            );
          }
        }).pipe(Effect.withSpan('AreasService.delete', { attributes: { id } }));

      return {
        create,
        findAll,
        findById,
        findByIdWithChildren,
        update,
        delete: remove,
      };
    }),
    dependencies: [AreasRepository.Default, LocationsService.Default],
  },
) {}
