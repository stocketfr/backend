import { Effect } from 'effect';
import type { Schema } from 'effect';
import type {
  AdjustInventorySchema,
  CreateInventorySchema,
  InventoryQuerySchema,
  UpdateInventorySchema,
} from '@stocket/types/inventory';
import { toPaginatedResponse } from '@stocket/types/common';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import { makeReferenceExistsValidator } from '../../platform/reference-data-service';
import { AreaNotFound, AreasInfrastructureError } from '../areas/areas.errors';
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

      const getInventoryOrFail = makeGetOrFail(
        (id: string) => repository.findById(id),
        (id) => new InventoryNotFound({ id, messageKey: 'inventory.notFound' }),
      );

      const ensureProductExists = makeReferenceExistsValidator({
        existsById: (productId: string) => productsService.existsById(productId),
        makeNotFound: (productId) =>
          new InvalidInventoryProduct({
            productId,
            messageKey: 'inventory.productNotFound',
          }),
      });

      const ensureLocationExists = makeReferenceExistsValidator({
        existsById: (locationId: string) =>
          locationsService.existsById(locationId),
        makeNotFound: (locationId) =>
          new InvalidInventoryLocation({
            locationId,
            messageKey: 'inventory.locationNotFound',
          }),
      });

      const ensureProductCanBeQueried = makeReferenceExistsValidator({
        existsById: (productId: string) => productsService.existsById(productId),
        makeNotFound: (productId) =>
          new InventoryProductNotFound({
            productId,
            messageKey: 'inventory.productNotFound',
          }),
      });

      const ensureLocationCanBeQueried = makeReferenceExistsValidator({
        existsById: (locationId: string) =>
          locationsService.existsById(locationId),
        makeNotFound: (locationId) =>
          new InventoryLocationNotFound({
            locationId,
            messageKey: 'inventory.locationNotFound',
          }),
      });

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
        Effect.flatMap(areasService.findById(areaId), (area) =>
          area.location_id === locationId
            ? Effect.succeed(area)
            : Effect.fail(
                new InventoryAreaLocationMismatch({
                  areaId,
                  locationId,
                  messageKey: 'inventory.areaLocationMismatch',
                }),
              ),
        ).pipe(
          Effect.mapError((error) => {
            if (error instanceof AreaNotFound) {
              return new InvalidInventoryArea({
                areaId,
                messageKey: 'inventory.areaNotFound',
              });
            }

            if (error instanceof AreasInfrastructureError) {
              return new InventoryInfrastructureError({
                action: 'load inventory area',
                cause: error,
                messageKey: 'inventory.infrastructureFailed',
              });
            }

            return error;
          }),
        );

      const findAllPaginated = (query: InventoryQueryDto) =>
        Effect.map(repository.findAllPaginated(query), (result) =>
          toPaginatedResponse(result, toInventoryResponseDto),
        ).pipe(Effect.withSpan('InventoryService.findAllPaginated'));

      const findAll = () =>
        Effect.map(repository.findAll(), (inventoryItems) =>
          inventoryItems.map(toInventoryResponseDto),
        ).pipe(Effect.withSpan('InventoryService.findAll'));

      const findOne = (id: string) =>
        Effect.map(getInventoryOrFail(id), toInventoryResponseDto).pipe(
          Effect.withSpan('InventoryService.findOne', { attributes: { id } }),
        );

      const findByProduct = (productId: string) =>
        Effect.gen(function* () {
          yield* ensureProductCanBeQueried(productId);

          const inventoryItems = yield* repository.findByProductId(productId);
          return inventoryItems.map(toInventoryResponseDto);
        }).pipe(
          Effect.withSpan('InventoryService.findByProduct', {
            attributes: { productId },
          }),
        );

      const findSummary = () =>
        repository
          .findSummary()
          .pipe(Effect.withSpan('InventoryService.findSummary'));

      const findByLocation = (locationId: string) =>
        Effect.gen(function* () {
          yield* ensureLocationCanBeQueried(locationId);

          const inventoryItems = yield* repository.findByLocationId(locationId);
          return inventoryItems.map(toInventoryResponseDto);
        }).pipe(
          Effect.withSpan('InventoryService.findByLocation', {
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

          const existing = yield* repository.findByProductAndLocation(
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
        }).pipe(Effect.withSpan('InventoryService.create'));

      const update = (id: string, dto: UpdateInventoryDto) =>
        Effect.gen(function* () {
          const inventory = yield* getInventoryOrFail(id);

          if (Object.keys(dto).length === 0) {
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
            const existing = yield* repository.findByProductAndLocation(
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

          const updateData: Partial<Inventory> = {};
          if (dto.location_id !== undefined) {
            updateData.location_id = dto.location_id;
          }
          if (dto.area_id !== undefined) {
            updateData.area_id = dto.area_id;
          }
          if (dto.quantity !== undefined) {
            updateData.quantity = dto.quantity;
          }
          if (dto.batchNumber !== undefined) {
            updateData.batch_number = dto.batchNumber;
          }
          if (dto.expiry_date !== undefined) {
            updateData.expiry_date = dto.expiry_date;
          }
          if (dto.cost_per_unit !== undefined) {
            updateData.cost_per_unit = dto.cost_per_unit;
          }
          if (dto.received_date !== undefined) {
            updateData.received_date = dto.received_date;
          }

          yield* repository.update(id, updateData);

          const updatedInventory = yield* getInventoryOrFail(id);
          return toInventoryResponseDto(updatedInventory);
        }).pipe(
          Effect.withSpan('InventoryService.update', { attributes: { id } }),
        );

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
          Effect.withSpan('InventoryService.adjustQuantity', {
            attributes: { id },
          }),
        );

      const remove = (id: string) =>
        Effect.gen(function* () {
          yield* getInventoryOrFail(id);
          yield* repository.delete(id);
        }).pipe(
          Effect.withSpan('InventoryService.delete', { attributes: { id } }),
        );

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
