import { Effect } from 'effect';
import { toPaginatedResponse } from '@stocket/types/common';
import { makeEnsureExistsById } from '../../platform/effect/existence';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { AreasService } from '../areas/service';
import { LocationsService } from '../locations/service';
import { ProductsService } from '../products/service';
import {
  InvalidInventoryLocation,
  InvalidInventoryProduct,
  InventoryLocationNotFound,
  InventoryNotFound,
  InventoryProductNotFound,
} from './inventory.errors';
import { InventoryRepository } from './repository';
import { toInventoryResponseDto } from './mappers';
import type {
  AdjustInventoryDto,
  CreateInventoryDto,
  InventoryQueryDto,
  UpdateInventoryDto,
} from './types';
import { makeInventoryWriteWorkflows } from './write';

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

      const inventoryWriteWorkflows = makeInventoryWriteWorkflows({
        repository,
        areasService,
        ensureProductExists,
        ensureLocationExists,
        getInventoryOrFail,
      });

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
        inventoryWriteWorkflows.create(dto).pipe(trace.span('create'));

      const update = (id: string, dto: UpdateInventoryDto) =>
        inventoryWriteWorkflows
          .update(id, dto)
          .pipe(trace.span('update', { attributes: { id } }));

      const adjustQuantity = (id: string, dto: AdjustInventoryDto) =>
        inventoryWriteWorkflows.adjustQuantity(id, dto).pipe(
          trace.span('adjustQuantity', {
            attributes: { id },
          }),
        );

      const remove = (id: string) =>
        inventoryWriteWorkflows
          .delete(id)
          .pipe(trace.span('delete', { attributes: { id } }));

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
