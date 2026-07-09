import { Effect, Layer } from 'effect';
import { StockMovementReason } from '@stocket/types/stock-movements';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
} from '../../testing/integration-layer';
import {
  seedCategory,
  seedProduct,
  seedLocation,
  seedStockMovement,
  TEST_USER_ID,
} from '../../testing/seed';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { StockMovementsService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<StockMovementsService>;

beforeAll(() => {
  db = getTestDb();
  const dbLayer = makeTestDrizzleLayer();
  TestLayer = StockMovementsService.Default.pipe(Layer.provide(dbLayer));
});

afterAll(() => closeTestDb());
beforeEach(() => truncateAll());

const run = <A, E>(effect: Effect.Effect<A, E, StockMovementsService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const fail = <A, E>(effect: Effect.Effect<A, E, StockMovementsService>) =>
  Effect.runPromise(Effect.flip(effect.pipe(Effect.provide(TestLayer))));

describe('StockMovementsService Integration', () => {
  describe('create', () => {
    it('creates a stock movement with product and location references', async () => {
      const category = await seedCategory(db);
      const product = await seedProduct(db, { category_id: category.id });
      const location = await seedLocation(db);

      const result = await run(
        Effect.flatMap(StockMovementsService, (svc) =>
          svc.create(
            {
              product_id: product.id,
              to_location_id: location.id,
              quantity: 25,
              reason: StockMovementReason.PURCHASE_RECEIVE,
            } as any,
            TEST_USER_ID,
          ),
        ),
      );

      expect(result.quantity).toBe(25);
      expect(result.reason).toBe(StockMovementReason.PURCHASE_RECEIVE);
    });

    it('rejects nonexistent product', async () => {
      const error = await fail(
        Effect.flatMap(StockMovementsService, (svc) =>
          svc.create(
            {
              product_id: '00000000-0000-0000-0000-000000000000',
              quantity: 10,
              reason: StockMovementReason.PURCHASE_RECEIVE,
            } as any,
            TEST_USER_ID,
          ),
        ),
      );

      expect(error._tag).toBe('InvalidStockMovementProduct');
    });

    it('rejects nonexistent source location', async () => {
      const category = await seedCategory(db);
      const product = await seedProduct(db, { category_id: category.id });

      const error = await fail(
        Effect.flatMap(StockMovementsService, (svc) =>
          svc.create(
            {
              product_id: product.id,
              from_location_id: '00000000-0000-0000-0000-000000000000',
              quantity: 10,
              reason: StockMovementReason.INTERNAL_TRANSFER,
            } as any,
            TEST_USER_ID,
          ),
        ),
      );

      expect(error._tag).toBe('InvalidSourceLocation');
    });

    it('rejects nonexistent destination location', async () => {
      const category = await seedCategory(db);
      const product = await seedProduct(db, { category_id: category.id });

      const error = await fail(
        Effect.flatMap(StockMovementsService, (svc) =>
          svc.create(
            {
              product_id: product.id,
              to_location_id: '00000000-0000-0000-0000-000000000000',
              quantity: 10,
              reason: StockMovementReason.INTERNAL_TRANSFER,
            } as any,
            TEST_USER_ID,
          ),
        ),
      );

      expect(error._tag).toBe('InvalidDestinationLocation');
    });
  });

  describe('findOne', () => {
    it('returns a stock movement by ID', async () => {
      const category = await seedCategory(db);
      const product = await seedProduct(db, { category_id: category.id });
      const movement = await seedStockMovement(db, {
        product_id: product.id,
        user_id: TEST_USER_ID,
        quantity: 15,
      });

      const result = await run(
        Effect.flatMap(StockMovementsService, (svc) =>
          svc.findOne(movement.id),
        ),
      );

      expect(result.quantity).toBe(15);
    });

    it('fails for nonexistent movement', async () => {
      const error = await fail(
        Effect.flatMap(StockMovementsService, (svc) =>
          svc.findOne('00000000-0000-0000-0000-000000000000'),
        ),
      );

      expect(error._tag).toBe('StockMovementNotFound');
    });
  });

  describe('findByProduct', () => {
    it('returns movements for a product', async () => {
      const category = await seedCategory(db);
      const product = await seedProduct(db, { category_id: category.id });
      await seedStockMovement(db, {
        product_id: product.id,
        user_id: TEST_USER_ID,
      });
      await seedStockMovement(db, {
        product_id: product.id,
        user_id: TEST_USER_ID,
      });

      const result = await run(
        Effect.flatMap(StockMovementsService, (svc) =>
          svc.findByProduct(product.id),
        ),
      );

      expect(result).toHaveLength(2);
    });

    it('rejects nonexistent product', async () => {
      const error = await fail(
        Effect.flatMap(StockMovementsService, (svc) =>
          svc.findByProduct('00000000-0000-0000-0000-000000000000'),
        ),
      );

      expect(error._tag).toBe('StockMovementProductNotFound');
    });
  });

  describe('findByLocation', () => {
    it('returns movements for a location', async () => {
      const category = await seedCategory(db);
      const product = await seedProduct(db, { category_id: category.id });
      const location = await seedLocation(db);
      await seedStockMovement(db, {
        product_id: product.id,
        user_id: TEST_USER_ID,
        to_location_id: location.id,
      });

      const result = await run(
        Effect.flatMap(StockMovementsService, (svc) =>
          svc.findByLocation(location.id),
        ),
      );

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects nonexistent location', async () => {
      const error = await fail(
        Effect.flatMap(StockMovementsService, (svc) =>
          svc.findByLocation('00000000-0000-0000-0000-000000000000'),
        ),
      );

      expect(error._tag).toBe('StockMovementLocationNotFound');
    });
  });

  describe('findAllPaginated', () => {
    it('paginates stock movements', async () => {
      const category = await seedCategory(db);
      const product = await seedProduct(db, { category_id: category.id });
      await seedStockMovement(db, {
        product_id: product.id,
        user_id: TEST_USER_ID,
      });
      await seedStockMovement(db, {
        product_id: product.id,
        user_id: TEST_USER_ID,
      });
      await seedStockMovement(db, {
        product_id: product.id,
        user_id: TEST_USER_ID,
      });

      const result = await run(
        Effect.flatMap(StockMovementsService, (svc) =>
          svc.findAllPaginated({ page: 1, limit: 2 } as any),
        ),
      );

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(3);
    });
  });
});
