import { Effect } from 'effect';
import type { CreateAreaDto, UpdateAreaDto } from '@stocket/types/areas';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import type { AreasRepository } from './repository';
import {
  AreaCircularReference,
  AreaLocationNotFound,
  AreaNotFound,
  AreaParentLocationMismatch,
  type AreasInfrastructureError,
  AreaSelfParent,
  ParentAreaNotFound,
} from './areas.errors';
import { toAreaResponseDto } from './mappers';
import type { Area } from './types';

export type AreaWriteRepository = Pick<
  AreasRepository,
  'create' | 'delete' | 'findById' | 'update'
>;

interface AreaWriteWorkflowOptions<LocationError, LocationContext> {
  readonly repository: AreaWriteRepository;
  readonly locationExists: (
    locationId: string,
  ) => Effect.Effect<boolean, LocationError, LocationContext>;
}

const makeAreaNotFound = (id: string) =>
  new AreaNotFound({ id, messageKey: 'areas.notFound' });

const getAreaOrFail = (repository: AreaWriteRepository, id: string) =>
  makeGetOrFail(
    (areaId: string) => repository.findById(areaId),
    makeAreaNotFound,
  )(id);

const wouldCreateCircularReference = (
  repository: AreaWriteRepository,
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

export const makeAreaWriteWorkflows = <LocationError, LocationContext>({
  repository,
  locationExists,
}: AreaWriteWorkflowOptions<LocationError, LocationContext>) => {
  const create = (dto: CreateAreaDto) =>
    Effect.gen(function* () {
      const foundLocation = yield* locationExists(dto.location_id);
      if (!foundLocation) {
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
    });

  const update = (id: string, dto: UpdateAreaDto) =>
    Effect.gen(function* () {
      const existingArea = yield* getAreaOrFail(repository, id);

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
          repository,
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
        return yield* Effect.fail(makeAreaNotFound(id));
      }
      return toAreaResponseDto(updated);
    });

  const remove = (id: string) =>
    Effect.gen(function* () {
      const deleted = yield* repository.delete(id);
      if (!deleted) {
        return yield* Effect.fail(makeAreaNotFound(id));
      }
    });

  return {
    create,
    update,
    delete: remove,
  };
};
