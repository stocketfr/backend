import type {
  CreateStockMovementSchema,
  StockMovementQueryDto,
} from '@stocket/types/stock-movements';
import { toPaginatedResponse } from '@stocket/types/common';
import type { Schema } from 'effect';
import { Effect } from 'effect';
import { makeEnsureExistsById } from '../../platform/effect/existence';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { LocationsService } from '../locations/service';
import { ProductsService } from '../products/service';
import { StockMovementsRepository } from './repository';
import {
  InvalidDestinationLocation,
  InvalidSourceLocation,
  InvalidStockMovementOrder,
  InvalidStockMovementProduct,
  StockMovementLocationNotFound,
  StockMovementNotFound,
  StockMovementProductNotFound,
} from './stock-movements.errors';
import { toStockMovementResponseDto } from './stock-movements.utils';

type CreateStockMovementDto = Schema.Schema.Type<
  typeof CreateStockMovementSchema
>;

export class StockMovementsService extends Effect.Service<StockMovementsService>()(
  '@stocket/effect/stock-movements/StockMovementsService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* StockMovementsRepository;
      const productsService = yield* ProductsService;
      const locationsService = yield* LocationsService;
      const trace = makeServiceTracer({
        serviceName: 'StockMovementsService',
        module: 'stock-movements',
        layer: 'service',
      });

      const getMovementOrFail = makeGetOrFail(
        (id: string) => repository.findById(id),
        (id) =>
          new StockMovementNotFound({
            id,
            messageKey: 'stockMovements.notFound',
          }),
      );

      const ensureProductForLookup = makeEnsureExistsById(
        productsService.existsById,
        (productId) =>
          new StockMovementProductNotFound({
            productId,
            messageKey: 'stockMovements.productNotFound',
          }),
      );

      const ensureLocationForLookup = makeEnsureExistsById(
        locationsService.existsById,
        (locationId) =>
          new StockMovementLocationNotFound({
            locationId,
            messageKey: 'stockMovements.locationNotFound',
          }),
      );

      const ensureProductForCreate = makeEnsureExistsById(
        productsService.existsById,
        (productId) =>
          new InvalidStockMovementProduct({
            productId,
            messageKey: 'stockMovements.productNotFound',
          }),
      );

      const ensureSourceLocationForCreate = makeEnsureExistsById(
        locationsService.existsById,
        (locationId) =>
          new InvalidSourceLocation({
            locationId,
            messageKey: 'stockMovements.sourceLocationNotFound',
          }),
      );

      const ensureDestinationLocationForCreate = makeEnsureExistsById(
        locationsService.existsById,
        (locationId) =>
          new InvalidDestinationLocation({
            locationId,
            messageKey: 'stockMovements.destinationLocationNotFound',
          }),
      );

      const ensureOrderForCreate = makeEnsureExistsById(
        repository.orderExistsById,
        (orderId) =>
          new InvalidStockMovementOrder({
            orderId,
            messageKey: 'stockMovements.orderNotFound',
          }),
      );

      const findAllPaginated = (query: StockMovementQueryDto) =>
        Effect.map(repository.findAllPaginated(query), (result) =>
          toPaginatedResponse(result, toStockMovementResponseDto),
        ).pipe(trace.span('findAllPaginated'));

      const findOne = (id: string) =>
        Effect.map(getMovementOrFail(id), toStockMovementResponseDto).pipe(
          trace.span('findOne', { attributes: { id } }),
        );

      const findByProduct = (productId: string) =>
        Effect.gen(function* () {
          yield* ensureProductForLookup(productId);

          const stockMovements = yield* repository.findByProductId(productId);
          return stockMovements.map(toStockMovementResponseDto);
        }).pipe(
          trace.span('findByProduct', {
            attributes: { productId },
          }),
        );

      const findByLocation = (locationId: string) =>
        Effect.gen(function* () {
          yield* ensureLocationForLookup(locationId);

          const stockMovements = yield* repository.findByLocationId(locationId);
          return stockMovements.map(toStockMovementResponseDto);
        }).pipe(
          trace.span('findByLocation', {
            attributes: { locationId },
          }),
        );

      const create = (dto: CreateStockMovementDto, userId: string) =>
        Effect.gen(function* () {
          yield* ensureProductForCreate(dto.product_id);

          if (dto.from_location_id) {
            yield* ensureSourceLocationForCreate(dto.from_location_id);
          }

          if (dto.to_location_id) {
            yield* ensureDestinationLocationForCreate(dto.to_location_id);
          }

          if (dto.order_id) {
            yield* ensureOrderForCreate(dto.order_id);
          }

          const stockMovement = yield* repository.create({
            product_id: dto.product_id,
            from_location_id: dto.from_location_id ?? null,
            to_location_id: dto.to_location_id ?? null,
            quantity: dto.quantity,
            reason: dto.reason,
            order_id: dto.order_id ?? null,
            reference_number: dto.reference_number ?? null,
            cost_per_unit: dto.cost_per_unit ?? null,
            notes: dto.notes ?? null,
            user_id: userId,
          });

          const stockMovementWithRelations = yield* getMovementOrFail(
            stockMovement.id,
          );
          return toStockMovementResponseDto(stockMovementWithRelations);
        }).pipe(
          trace.span('create', {
            attributes: { productId: dto.product_id },
          }),
        );

      return {
        findAllPaginated,
        findOne,
        findByProduct,
        findByLocation,
        create,
      };
    }),
    dependencies: [
      StockMovementsRepository.Default,
      ProductsService.Default,
      LocationsService.Default,
    ],
  },
) {}
