import { Effect, Layer } from 'effect';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
} from '../../test/integration-layer';
import { seedSupplier } from '../../test/seed';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { SuppliersService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<SuppliersService>;

beforeAll(() => {
  db = getTestDb();
  const dbLayer = makeTestDrizzleLayer();
  TestLayer = SuppliersService.Default.pipe(Layer.provide(dbLayer));
});

afterAll(() => closeTestDb());
beforeEach(() => truncateAll());

const run = <A, E>(effect: Effect.Effect<A, E, SuppliersService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const fail = <A, E>(effect: Effect.Effect<A, E, SuppliersService>) =>
  Effect.runPromise(Effect.flip(effect.pipe(Effect.provide(TestLayer))));

describe('SuppliersService Integration', () => {
  describe('create', () => {
    it('creates a supplier', async () => {
      const result = await run(
        Effect.flatMap(SuppliersService, (svc) =>
          svc.create({ name: 'Bordeaux Imports' } as any),
        ),
      );

      expect(result.name).toBe('Bordeaux Imports');
    });
  });

  describe('findOne', () => {
    it('returns a supplier by ID', async () => {
      const supplier = await seedSupplier(db, { name: 'Rhône Valley' });

      const result = await run(
        Effect.flatMap(SuppliersService, (svc) => svc.findOne(supplier.id)),
      );

      expect(result.name).toBe('Rhône Valley');
    });

    it('fails for nonexistent supplier', async () => {
      const error = await fail(
        Effect.flatMap(SuppliersService, (svc) =>
          svc.findOne('00000000-0000-0000-0000-000000000000'),
        ),
      );

      expect(error._tag).toBe('SupplierNotFound');
    });
  });

  describe('update', () => {
    it('updates supplier fields', async () => {
      const supplier = await seedSupplier(db);

      const result = await run(
        Effect.flatMap(SuppliersService, (svc) =>
          svc.update(supplier.id, { name: 'New Supplier Name' } as any),
        ),
      );

      expect(result.name).toBe('New Supplier Name');
    });
  });

  describe('delete', () => {
    it('deletes a supplier', async () => {
      const supplier = await seedSupplier(db);

      await run(
        Effect.flatMap(SuppliersService, (svc) => svc.delete(supplier.id)),
      );

      const error = await fail(
        Effect.flatMap(SuppliersService, (svc) => svc.findOne(supplier.id)),
      );
      expect(error._tag).toBe('SupplierNotFound');
    });
  });

  describe('findAllPaginated', () => {
    it('paginates and filters by search', async () => {
      await seedSupplier(db, { name: 'Bordeaux Imports' });
      await seedSupplier(db, { name: 'Burgundy Wines' });
      await seedSupplier(db, { name: 'Bordeaux Direct' });

      const result = await run(
        Effect.flatMap(SuppliersService, (svc) =>
          svc.findAllPaginated({ page: 1, limit: 10, q: 'Bordeaux' } as any),
        ),
      );

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });
  });

  describe('existsById', () => {
    it('returns true for existing, false for missing', async () => {
      const supplier = await seedSupplier(db);

      const [exists, missing] = await run(
        Effect.flatMap(SuppliersService, (svc) =>
          Effect.all([
            svc.existsById(supplier.id),
            svc.existsById('00000000-0000-0000-0000-000000000000'),
          ]),
        ),
      );

      expect(exists).toBe(true);
      expect(missing).toBe(false);
    });
  });
});
