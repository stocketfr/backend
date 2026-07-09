import { type Mock } from 'vitest';
import { Effect, Layer } from 'effect';
import { StockMovementReason } from '@stocket/types/stock-movements';
import { ProductsService } from '../products/service';
import { LocationsService } from '../locations/service';
import { StockMovementsService } from './service';
import { StockMovementsRepository } from './repository';

const makeStockMovementEntity = (overrides: Record<string, any> = {}) => ({
  id: 'stock-movement-1',
  product_id: 'product-1',
  product: {
    id: 'product-1',
    name: 'Orange Juice',
    sku: 'OJ-001',
  },
  from_location_id: 'location-1',
  fromLocation: {
    id: 'location-1',
    name: 'Warehouse A',
  },
  to_location_id: 'location-2',
  toLocation: {
    id: 'location-2',
    name: 'Store B',
  },
  quantity: 12,
  reason: StockMovementReason.INTERNAL_TRANSFER,
  order_id: null,
  reference_number: 'REF-001',
  cost_per_unit: 4.5,
  kanban_task_id: null,
  user_id: 'user-1',
  notes: 'Move stock',
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const makeMockRepository = (
  overrides: Partial<
    Record<keyof import('./repository').StockMovementsRepository, Mock>
  > = {},
) => ({
  findAllPaginated: vi.fn().mockReturnValue(
    Effect.succeed({
      data: [makeStockMovementEntity()],
      total: 1,
      page: 1,
      limit: 20,
      total_pages: 1,
    }),
  ),
  findById: vi.fn().mockReturnValue(Effect.succeed(makeStockMovementEntity())),
  findByProductId: vi
    .fn()
    .mockReturnValue(Effect.succeed([makeStockMovementEntity()])),
  findByLocationId: vi
    .fn()
    .mockReturnValue(Effect.succeed([makeStockMovementEntity()])),
  create: vi
    .fn()
    .mockReturnValue(
      Effect.succeed(makeStockMovementEntity({ id: 'stock-movement-created' })),
    ),
  ...overrides,
});

const makeMockProductsService = (
  overrides: Partial<
    Record<keyof import('../products/service').ProductsService, Mock>
  > = {},
) =>
  ({
    existsById: vi.fn().mockReturnValue(Effect.succeed(true)),
    ...overrides,
  }) as any;

const makeMockLocationsService = (
  overrides: Partial<
    Record<keyof import('../locations/service').LocationsService, Mock>
  > = {},
) =>
  ({
    existsById: vi.fn().mockReturnValue(Effect.succeed(true)),
    ...overrides,
  }) as any;

const buildService = (
  repository = makeMockRepository(),
  productsService = makeMockProductsService(),
  locationsService = makeMockLocationsService(),
) =>
  Effect.runPromise(
    StockMovementsService.pipe(
      Effect.provide(
        StockMovementsService.DefaultWithoutDependencies.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(StockMovementsRepository, repository as any),
              Layer.succeed(ProductsService, productsService),
              Layer.succeed(LocationsService, locationsService),
            ),
          ),
        ),
      ),
    ),
  );

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const fail = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(effect));

describe('Effect StockMovementsService', () => {
  describe('findAllPaginated', () => {
    it('returns paginated stock movements', async () => {
      const service = await buildService();
      const result = await run(
        service.findAllPaginated({ page: 1, limit: 20 } as any),
      );

      expect(result.data).toHaveLength(1);
      expect(result.meta).toMatchObject({ page: 1, total: 1 });
    });
  });

  describe('findOne', () => {
    it('returns a stock movement', async () => {
      const service = await buildService();
      const result = await run(service.findOne('stock-movement-1'));

      expect(result).toMatchObject({
        id: 'stock-movement-1',
        product_id: 'product-1',
      });
    });

    it('fails with StockMovementNotFound', async () => {
      const repository = makeMockRepository({
        findById: vi.fn().mockReturnValue(Effect.succeed(null)),
      });
      const service = await buildService(repository);

      const error = await fail(service.findOne('missing'));
      expect(error).toMatchObject({ _tag: 'StockMovementNotFound' });
    });
  });

  describe('findByProduct', () => {
    it('returns stock movements for a product', async () => {
      const repository = makeMockRepository();
      const service = await buildService(repository);

      const result = await run(service.findByProduct('product-1'));

      expect(result).toHaveLength(1);
      expect(repository.findByProductId).toHaveBeenCalledWith('product-1');
    });

    it('fails when product does not exist', async () => {
      const productsService = makeMockProductsService({
        existsById: vi.fn().mockReturnValue(Effect.succeed(false)),
      });
      const service = await buildService(undefined, productsService);

      const error = await fail(service.findByProduct('missing'));
      expect(error).toMatchObject({ _tag: 'StockMovementProductNotFound' });
    });
  });

  describe('findByLocation', () => {
    it('returns stock movements for a location', async () => {
      const repository = makeMockRepository();
      const service = await buildService(repository);

      const result = await run(service.findByLocation('location-1'));

      expect(result).toHaveLength(1);
      expect(repository.findByLocationId).toHaveBeenCalledWith('location-1');
    });

    it('fails when location does not exist', async () => {
      const locationsService = makeMockLocationsService({
        existsById: vi.fn().mockReturnValue(Effect.succeed(false)),
      });
      const service = await buildService(
        undefined,
        undefined,
        locationsService,
      );

      const error = await fail(service.findByLocation('missing'));
      expect(error).toMatchObject({ _tag: 'StockMovementLocationNotFound' });
    });
  });

  describe('create', () => {
    const createDto = {
      product_id: 'product-1',
      from_location_id: 'location-1',
      to_location_id: 'location-2',
      quantity: 3,
      reason: StockMovementReason.INTERNAL_TRANSFER,
      order_id: null,
      reference_number: 'REF-123',
      cost_per_unit: 12.5,
      notes: 'Transfer',
    } as any;

    it('validates and creates a stock movement', async () => {
      const repository = makeMockRepository({
        findById: vi
          .fn()
          .mockReturnValueOnce(
            Effect.succeed(
              makeStockMovementEntity({ id: 'stock-movement-created' }),
            ),
          ),
      });
      const service = await buildService(repository);

      const result = await run(service.create(createDto, 'user-1'));

      expect(repository.create).toHaveBeenCalledWith({
        product_id: 'product-1',
        from_location_id: 'location-1',
        to_location_id: 'location-2',
        quantity: 3,
        reason: StockMovementReason.INTERNAL_TRANSFER,
        order_id: null,
        reference_number: 'REF-123',
        cost_per_unit: 12.5,
        notes: 'Transfer',
        user_id: 'user-1',
      });
      expect(result).toMatchObject({ id: 'stock-movement-created' });
    });

    it('fails when product does not exist', async () => {
      const productsService = makeMockProductsService({
        existsById: vi.fn().mockReturnValue(Effect.succeed(false)),
      });
      const service = await buildService(undefined, productsService);

      const error = await fail(service.create(createDto, 'user-1'));
      expect(error).toMatchObject({ _tag: 'InvalidStockMovementProduct' });
    });

    it('fails when source location does not exist', async () => {
      const locationsService = makeMockLocationsService({
        existsById: vi.fn().mockReturnValueOnce(Effect.succeed(false)),
      });
      const service = await buildService(
        undefined,
        undefined,
        locationsService,
      );

      const error = await fail(service.create(createDto, 'user-1'));
      expect(error).toMatchObject({ _tag: 'InvalidSourceLocation' });
    });

    it('fails when destination location does not exist', async () => {
      const locationsService = makeMockLocationsService({
        existsById: vi
          .fn()
          .mockReturnValueOnce(Effect.succeed(true))
          .mockReturnValueOnce(Effect.succeed(false)),
      });
      const service = await buildService(
        undefined,
        undefined,
        locationsService,
      );

      const error = await fail(service.create(createDto, 'user-1'));
      expect(error).toMatchObject({ _tag: 'InvalidDestinationLocation' });
    });
  });
});
