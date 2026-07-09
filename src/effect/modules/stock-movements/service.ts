import type { StockMovementQueryDto } from '@stocket/types/stock-movements';
import { toPaginatedResponse } from '@stocket/types/common';
import { Effect } from 'effect';
import { makeEnsureExistsById } from '../../platform/effect/existence';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { LocationsService } from '../locations/service';
import { ProductsService } from '../products/service';
import { StockMovementsRepository } from './repository';
import {
  StockMovementLocationNotFound,
  StockMovementNotFound,
  StockMovementProductNotFound,
} from './stock-movements.errors';
import { toStockMovementResponseDto } from './mappers';
import type { CreateStockMovementDto } from './types';
import { makeStockMovementWriteWorkflows } from './write';

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

      const stockMovementWriteWorkflows = makeStockMovementWriteWorkflows({
        repository,
        productExists: productsService.existsById,
        locationExists: locationsService.existsById,
      });

      const create = (dto: CreateStockMovementDto, userId: string) =>
        stockMovementWriteWorkflows.create(dto, userId).pipe(
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
