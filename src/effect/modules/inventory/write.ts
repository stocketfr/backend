import { Effect } from 'effect';
import {
  hasDefinedPatchValues,
  pickDefined,
} from '../../platform/effect/pick-defined';
import {
  InventoryAlreadyExists,
  InventoryQuantityAdjustmentFailed,
} from './inventory.errors';
import type { InventoryRepository } from './repository';
import {
  getAreaForInventoryLocation,
  type InventoryAreaLookup,
} from './area-validation';
import { toInventoryResponseDto } from './mappers';
import type {
  AdjustInventoryDto,
  CreateInventoryDto,
  Inventory,
  UpdateInventoryDto,
} from './types';

export type InventoryWriteRepository = Pick<
  InventoryRepository,
  | 'adjustQuantity'
  | 'create'
  | 'delete'
  | 'findByProductAndLocationWithRelations'
  | 'update'
>;

type InventoryWithRelations = NonNullable<
  Effect.Effect.Success<
    ReturnType<InventoryRepository['findByIdWithRelations']>
  >
>;

interface InventoryWriteWorkflowOptions<
  ProductError,
  ProductContext,
  LocationError,
  LocationContext,
  GetInventoryError,
  GetInventoryContext,
> {
  readonly repository: InventoryWriteRepository;
  readonly areasService: InventoryAreaLookup;
  readonly ensureProductExists: (
    productId: string,
  ) => Effect.Effect<void, ProductError, ProductContext>;
  readonly ensureLocationExists: (
    locationId: string,
  ) => Effect.Effect<void, LocationError, LocationContext>;
  readonly getInventoryOrFail: (
    id: string,
  ) => Effect.Effect<
    InventoryWithRelations,
    GetInventoryError,
    GetInventoryContext
  >;
}

export const makeInventoryWriteWorkflows = <
  ProductError,
  ProductContext,
  LocationError,
  LocationContext,
  GetInventoryError,
  GetInventoryContext,
>({
  repository,
  areasService,
  ensureProductExists,
  ensureLocationExists,
  getInventoryOrFail,
}: InventoryWriteWorkflowOptions<
  ProductError,
  ProductContext,
  LocationError,
  LocationContext,
  GetInventoryError,
  GetInventoryContext
>) => {
  const create = (dto: CreateInventoryDto) =>
    Effect.gen(function* () {
      yield* ensureProductExists(dto.product_id);
      yield* ensureLocationExists(dto.location_id);

      if (dto.area_id) {
        yield* getAreaForInventoryLocation(
          areasService,
          dto.area_id,
          dto.location_id,
        );
      }

      const existing = yield* repository.findByProductAndLocationWithRelations(
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

      const inventoryWithRelations = yield* getInventoryOrFail(inventory.id);
      return toInventoryResponseDto(inventoryWithRelations);
    });

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
        yield* getAreaForInventoryLocation(
          areasService,
          newAreaId,
          newLocationId,
        );
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
    });

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
    });

  const remove = (id: string) =>
    Effect.gen(function* () {
      yield* getInventoryOrFail(id);
      yield* repository.delete(id);
    });

  return {
    create,
    update,
    adjustQuantity,
    delete: remove,
  };
};
