import { Effect } from 'effect';
import type { Schema } from 'effect';
import type {
  AdjustInventorySchema,
  CreateInventorySchema,
  InventoryQuerySchema,
  UpdateInventorySchema,
} from '@stocket/types/inventory';
import { toPaginatedResponse } from '@stocket/types/common';
import { makeEnsureExistsById } from '../../platform/effect/existence';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import {
  hasDefinedPatchValues,
  pickDefined,
} from '../../platform/effect/pick-defined';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { AreasService } from '../areas/service';
import { LocationsService } from '../locations/service';
import { ProductsService } from '../products/service';
import {
  InvalidInventoryArea,
  InvalidInventoryLocation,
  InvalidInventoryProduct,
  InventoryAlreadyExists,
  InventoryAreaLocationMismatch,
  InventoryInfrastructureError,
  InventoryLocationNotFound,
  InventoryNotFound,
  InventoryProductNotFound,
  InventoryQuantityAdjustmentFailed,
} from './inventory.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { InventoryRepository } from './repository';
import { toInventoryResponseDto, type Inventory } from './inventory.utils';

type InventoryQueryDto = Schema.Schema.Type<typeof InventoryQuerySchema>;
type CreateInventoryDto = Schema.Schema.Type<typeof CreateInventorySchema>;
type UpdateInventoryDto = Schema.Schema.Type<typeof UpdateInventorySchema>;
type AdjustInventoryDto = Schema.Schema.Type<typeof AdjustInventorySchema>;

export class InventoryService extends Effect.Service<InventoryService>()(
  '@stocket/effect/inventory/InventoryService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* InventoryRepository;
      const productsService = yield* ProductsService;
      const locationsService = yield* LocationsService;
      const areasService = yield* AreasService;
      const trace = makeServiceTracer({
        serviceName: 'InventoryService',
        module: 'inventory',
        layer: 'service',
      });

      const getInventoryOrFail = makeGetOrFail(
        (id: string) => repository.findByIdWithRelations(id),
        (id) => new InventoryNotFound({ id, messageKey: 'inventory.notFound' }),
      );

      const ensureProductExists = makeEnsureExistsById(
        productsService.existsById,
        (productId) =>
          new InvalidInventoryProduct({
            productId,
            messageKey: 'inventory.productNotFound',
          }),
      );

      const ensureLocationExists = makeEnsureExistsById(
        locationsService.existsById,
        (locationId) =>
          new InvalidInventoryLocation({
            locationId,
            messageKey: 'inventory.locationNotFound',
          }),
      );

      const ensureProductForLookup = makeEnsureExistsById(
        productsService.existsById,
        (productId) =>
          new InventoryProductNotFound({
            productId,
            messageKey: 'inventory.productNotFound',
          }),
      );

      const ensureLocationForLookup = makeEnsureExistsById(
        locationsService.existsById,
        (locationId) =>
          new InventoryLocationNotFound({
            locationId,
            messageKey: 'inventory.locationNotFound',
          }),
      );

      const getAreaForLocation = (
        areaId: string,
        locationId: string,
      ): Effect.Effect<
        { id: string; location_id: string },
        | InvalidInventoryArea
        | InventoryAreaLocationMismatch
        | InventoryInfrastructureError
        | TenantNotResolved
      > =>
        areasService.findById(areaId).pipe(
          Effect.catchTag('AreaNotFound', () =>
            Effect.fail(
              new InvalidInventoryArea({
                areaId,
                messageKey: 'inventory.areaNotFound',
              }),
            ),
          ),
          Effect.catchTag('AreasInfrastructureError', (error) =>
            Effect.fail(
              new InventoryInfrastructureError({
                action: 'load inventory area',
                cause: error,
                messageKey: 'inventory.infrastructureFailed',
              }),
            ),
          ),
          Effect.flatMap((area) =>
            area.location_id === locationId
              ? Effect.succeed(area)
              : Effect.fail(
                  new InventoryAreaLocationMismatch({
                    areaId,
                    locationId,
                    messageKey: 'inventory.areaLocationMismatch',
                  }),
                ),
          ),
        );

      const findAllPaginated = (query: InventoryQueryDto) =>
        Effect.map(repository.findAllPaginatedWithRelations(query), (result) =>
          toPaginatedResponse(result, toInventoryResponseDto),
        ).pipe(trace.span('findAllPaginated'));

      const findAll = () =>
        Effect.map(repository.findAllWithRelations(), (inventoryItems) =>
          inventoryItems.map(toInventoryResponseDto),
        ).pipe(trace.span('findAll'));

      const findOne = (id: string) =>
        Effect.map(getInventoryOrFail(id), toInventoryResponseDto).pipe(
          trace.span('findOne', { attributes: { id } }),
        );

      const findByProduct = (productId: string) =>
        Effect.gen(function* () {
          yield* ensureProductForLookup(productId);

          const inventoryItems =
            yield* repository.findByProductIdWithRelations(productId);
          return inventoryItems.map(toInventoryResponseDto);
        }).pipe(
          trace.span('findByProduct', {
            attributes: { productId },
          }),
        );

      const findSummary = () =>
        repository.findSummary().pipe(trace.span('findSummary'));

      const findByLocation = (locationId: string) =>
        Effect.gen(function* () {
          yield* ensureLocationForLookup(locationId);

          const inventoryItems =
            yield* repository.findByLocationIdWithRelations(locationId);
          return inventoryItems.map(toInventoryResponseDto);
        }).pipe(
          trace.span('findByLocation', {
            attributes: { locationId },
          }),
        );

      const create = (dto: CreateInventoryDto) =>
        Effect.gen(function* () {
          yield* ensureProductExists(dto.product_id);
          yield* ensureLocationExists(dto.location_id);

          if (dto.area_id) {
            yield* getAreaForLocation(dto.area_id, dto.location_id);
          }

          const existing =
            yield* repository.findByProductAndLocationWithRelations(
              dto.product_id,
              dto.location_id,
              dto.area_id,
            );
          if (existing) {
            return yield* Effect.fail(
              new InventoryAlreadyExists({
                productId: dto.product_id,
                locationId: dto.location_id,
                areaId: dto.area_id,
                messageKey: 'inventory.alreadyExists',
              }),
            );
          }

          const inventory = yield* repository.create({
            product_id: dto.product_id,
            location_id: dto.location_id,
            area_id: dto.area_id ?? null,
            quantity: dto.quantity,
            batch_number: dto.batchNumber ?? '',
            expiry_date: dto.expiry_date ?? null,
            cost_per_unit: dto.cost_per_unit ?? null,
            received_date: dto.received_date ?? null,
          });

          const inventoryWithRelations = yield* getInventoryOrFail(
            inventory.id,
          );
          return toInventoryResponseDto(inventoryWithRelations);
        }).pipe(trace.span('create'));

      const update = (id: string, dto: UpdateInventoryDto) =>
        Effect.gen(function* () {
          const inventory = yield* getInventoryOrFail(id);
          const updateData = pickDefined<Inventory>([
            ['location_id', dto.location_id],
            ['area_id', dto.area_id],
            ['quantity', dto.quantity],
            ['batch_number', dto.batchNumber],
            ['expiry_date', dto.expiry_date],
            ['cost_per_unit', dto.cost_per_unit],
            ['received_date', dto.received_date],
          ]);

          if (!hasDefinedPatchValues(updateData)) {
            return toInventoryResponseDto(inventory);
          }

          const newLocationId = dto.location_id ?? inventory.location_id;
          const newAreaId =
            dto.area_id !== undefined ? dto.area_id : inventory.area_id;

          if (dto.location_id && dto.location_id !== inventory.location_id) {
            yield* ensureLocationExists(dto.location_id);
          }

          if (newAreaId) {
            yield* getAreaForLocation(newAreaId, newLocationId);
          }

          const locationChanged =
            dto.location_id !== undefined &&
            dto.location_id !== inventory.location_id;
          const areaChanged =
            dto.area_id !== undefined && dto.area_id !== inventory.area_id;

          if (locationChanged || areaChanged) {
            const existing =
              yield* repository.findByProductAndLocationWithRelations(
                inventory.product_id,
                newLocationId,
                newAreaId,
              );

            if (existing && existing.id !== id) {
              return yield* Effect.fail(
                new InventoryAlreadyExists({
                  productId: inventory.product_id,
                  locationId: newLocationId,
                  areaId: newAreaId,
                  messageKey: 'inventory.alreadyExists',
                }),
              );
            }
          }

          yield* repository.update(id, updateData);

          const updatedInventory = yield* getInventoryOrFail(id);
          return toInventoryResponseDto(updatedInventory);
        }).pipe(trace.span('update', { attributes: { id } }));

      const adjustQuantity = (id: string, dto: AdjustInventoryDto) =>
        Effect.gen(function* () {
          yield* getInventoryOrFail(id);

          const affected = yield* repository.adjustQuantity(id, dto.adjustment);
          if (affected === 0) {
            return yield* Effect.fail(
              new InventoryQuantityAdjustmentFailed({
                id,
                adjustment: dto.adjustment,
                messageKey: 'inventory.quantityAdjustmentNegative',
              }),
            );
          }

          const updatedInventory = yield* getInventoryOrFail(id);
          return toInventoryResponseDto(updatedInventory);
        }).pipe(
          trace.span('adjustQuantity', {
            attributes: { id },
          }),
        );

      const remove = (id: string) =>
        Effect.gen(function* () {
          yield* getInventoryOrFail(id);
          yield* repository.delete(id);
        }).pipe(trace.span('delete', { attributes: { id } }));

      return {
        findAllPaginated,
        findAll,
        findOne,
        findByProduct,
        findSummary,
        findByLocation,
        create,
        update,
        adjustQuantity,
        delete: remove,
      };
    }),
    dependencies: [
      InventoryRepository.Default,
      ProductsService.Default,
      LocationsService.Default,
      AreasService.Default,
    ],
  },
) {}
