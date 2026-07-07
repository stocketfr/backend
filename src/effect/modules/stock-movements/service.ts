import type {
  CreateStockMovementSchema,
  StockMovementQueryDto,
} from '@stocket/types/stock-movements';
import { toPaginatedResponse } from '@stocket/types/common';
import type { Schema } from 'effect';
import { Effect } from 'effect';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import { makeReferenceExistsValidator } from '../../platform/reference-data-service';
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

      const getMovementOrFail = makeGetOrFail(
        (id: string) => repository.findById(id),
        (id) =>
          new StockMovementNotFound({
            id,
            messageKey: 'stockMovements.notFound',
          }),
      );

      const ensureProductCanBeQueried = makeReferenceExistsValidator({
        existsById: (productId: string) => productsService.existsById(productId),
        makeNotFound: (productId) =>
          new StockMovementProductNotFound({
            productId,
            messageKey: 'stockMovements.productNotFound',
          }),
      });

      const ensureLocationCanBeQueried = makeReferenceExistsValidator({
        existsById: (locationId: string) =>
          locationsService.existsById(locationId),
        makeNotFound: (locationId) =>
          new StockMovementLocationNotFound({
            locationId,
            messageKey: 'stockMovements.locationNotFound',
          }),
      });

      const ensureProductExists = makeReferenceExistsValidator({
        existsById: (productId: string) => productsService.existsById(productId),
        makeNotFound: (productId) =>
          new InvalidStockMovementProduct({
            productId,
            messageKey: 'stockMovements.productNotFound',
          }),
      });

      const ensureSourceLocationExists = makeReferenceExistsValidator({
        existsById: (locationId: string) =>
          locationsService.existsById(locationId),
        makeNotFound: (locationId) =>
          new InvalidSourceLocation({
            locationId,
            messageKey: 'stockMovements.sourceLocationNotFound',
          }),
      });

      const ensureDestinationLocationExists = makeReferenceExistsValidator({
        existsById: (locationId: string) =>
          locationsService.existsById(locationId),
        makeNotFound: (locationId) =>
          new InvalidDestinationLocation({
            locationId,
            messageKey: 'stockMovements.destinationLocationNotFound',
          }),
      });

      const ensureOrderExists = makeReferenceExistsValidator({
        existsById: (orderId: string) => repository.orderExistsById(orderId),
        makeNotFound: (orderId) =>
          new InvalidStockMovementOrder({
            orderId,
            messageKey: 'stockMovements.orderNotFound',
          }),
      });

      const findAllPaginated = (query: StockMovementQueryDto) =>
        Effect.map(repository.findAllPaginated(query), (result) =>
          toPaginatedResponse(result, toStockMovementResponseDto),
        ).pipe(Effect.withSpan('StockMovementsService.findAllPaginated'));

      const findOne = (id: string) =>
        Effect.map(getMovementOrFail(id), toStockMovementResponseDto).pipe(
          Effect.withSpan('StockMovementsService.findOne', {
            attributes: { id },
          }),
        );

      const findByProduct = (productId: string) =>
        Effect.gen(function* () {
          yield* ensureProductCanBeQueried(productId);

          const stockMovements = yield* repository.findByProductId(productId);
          return stockMovements.map(toStockMovementResponseDto);
        }).pipe(
          Effect.withSpan('StockMovementsService.findByProduct', {
            attributes: { productId },
          }),
        );

      const findByLocation = (locationId: string) =>
        Effect.gen(function* () {
          yield* ensureLocationCanBeQueried(locationId);

          const stockMovements = yield* repository.findByLocationId(locationId);
          return stockMovements.map(toStockMovementResponseDto);
        }).pipe(
          Effect.withSpan('StockMovementsService.findByLocation', {
            attributes: { locationId },
          }),
        );

      const create = (dto: CreateStockMovementDto, userId: string) =>
        Effect.gen(function* () {
          yield* ensureProductExists(dto.product_id);

          if (dto.from_location_id) {
            yield* ensureSourceLocationExists(dto.from_location_id);
          }

          if (dto.to_location_id) {
            yield* ensureDestinationLocationExists(dto.to_location_id);
          }

          if (dto.order_id) {
            yield* ensureOrderExists(dto.order_id);
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
          Effect.withSpan('StockMovementsService.create', {
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
