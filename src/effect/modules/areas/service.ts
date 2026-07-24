import { Effect } from 'effect';
import type {
  AreaResponseDto,
  AreaQueryDto,
  CreateAreaDto,
  UpdateAreaDto,
} from '@stocket/types/areas';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import { LocationsService } from '../locations/service';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { toAreaResponseDto } from './mappers';
import { AreaNotFound, type AreasInfrastructureError } from './areas.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { AreasRepository } from './repository';
import { makeAreaWriteWorkflows } from './write';

export class AreasService extends Effect.Service<AreasService>()(
  '@stocket/effect/areas/AreasService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* AreasRepository;
      const locationsService = yield* LocationsService;
      const trace = makeServiceTracer({
        serviceName: 'AreasService',
        module: 'areas',
        layer: 'service',
      });

      const getAreaOrFail = makeGetOrFail(
        (id: string) => repository.findById(id),
        (id) => new AreaNotFound({ id, messageKey: 'areas.notFound' }),
      );

      const areaWriteWorkflows = makeAreaWriteWorkflows({
        repository,
        locationExists: locationsService.existsById,
      });

      const create = (dto: CreateAreaDto) =>
        areaWriteWorkflows.create(dto).pipe(trace.span('create'));

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
        }).pipe(trace.span('findAll'));

      const findById = (
        id: string,
      ): Effect.Effect<
        AreaResponseDto,
        AreaNotFound | AreasInfrastructureError | TenantNotResolved
      > =>
        Effect.map(getAreaOrFail(id), toAreaResponseDto).pipe(
          trace.span('findById', { attributes: { id } }),
        );

      const findByIdsWithAncestors = (ids: readonly string[]) =>
        Effect.gen(function* () {
          const areasById = new Map<string, AreaResponseDto>();
          let pendingIds = [...new Set(ids)];

          while (pendingIds.length > 0) {
            const loaded = yield* repository.findByIds(pendingIds);
            for (const area of loaded) {
              areasById.set(area.id, toAreaResponseDto(area));
            }
            pendingIds = [
              ...new Set(
                loaded.flatMap((area) =>
                  area.parent_id && !areasById.has(area.parent_id)
                    ? [area.parent_id]
                    : [],
                ),
              ),
            ];
          }

          return [...areasById.values()];
        }).pipe(trace.span('findByIdsWithAncestors'));

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
        ).pipe(trace.span('findByIdWithChildren', { attributes: { id } }));

      const update = (id: string, dto: UpdateAreaDto) =>
        areaWriteWorkflows
          .update(id, dto)
          .pipe(trace.span('update', { attributes: { id } }));

      const remove = (
        id: string,
      ): Effect.Effect<
        void,
        AreaNotFound | AreasInfrastructureError | TenantNotResolved
      > =>
        areaWriteWorkflows
          .delete(id)
          .pipe(trace.span('delete', { attributes: { id } }));

      return {
        create,
        findAll,
        findById,
        findByIdsWithAncestors,
        findByIdWithChildren,
        update,
        delete: remove,
      };
    }),
    dependencies: [AreasRepository.Default, LocationsService.Default],
  },
) {}
