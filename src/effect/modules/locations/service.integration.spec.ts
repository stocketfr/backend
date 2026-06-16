import { Effect, Layer } from 'effect';
import { LocationType } from '@stocket/types/locations';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
} from '../../testing/integration-layer';
import { seedLocation } from '../../testing/seed';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { LocationsService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<LocationsService>;

beforeAll(() => {
  db = getTestDb();
  const dbLayer = makeTestDrizzleLayer();
  TestLayer = LocationsService.Default.pipe(Layer.provide(dbLayer));
});

afterAll(() => closeTestDb());
beforeEach(() => truncateAll());

const run = <A, E>(effect: Effect.Effect<A, E, LocationsService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const fail = <A, E>(effect: Effect.Effect<A, E, LocationsService>) =>
  Effect.runPromise(Effect.flip(effect.pipe(Effect.provide(TestLayer))));

describe('LocationsService Integration', () => {
  describe('create', () => {
    it('creates a location', async () => {
      const result = await run(
        Effect.flatMap(LocationsService, (svc) =>
          svc.create({
            name: 'Main Warehouse',
            type: LocationType.WAREHOUSE,
          } as any),
        ),
      );

      expect(result.name).toBe('Main Warehouse');
      expect(result.type).toBe(LocationType.WAREHOUSE);
    });
  });

  describe('findOne', () => {
    it('returns a location by ID', async () => {
      const location = await seedLocation(db, { name: 'Dock A' });

      const result = await run(
        Effect.flatMap(LocationsService, (svc) => svc.findOne(location.id)),
      );

      expect(result.name).toBe('Dock A');
    });

    it('fails for nonexistent location', async () => {
      const error = await fail(
        Effect.flatMap(LocationsService, (svc) =>
          svc.findOne('00000000-0000-0000-0000-000000000000'),
        ),
      );

      expect(error._tag).toBe('LocationNotFound');
    });
  });

  describe('findAll', () => {
    it('returns all locations', async () => {
      await seedLocation(db, { name: 'Warehouse A' });
      await seedLocation(db, { name: 'Warehouse B' });

      const result = await run(
        Effect.flatMap(LocationsService, (svc) => svc.findAll()),
      );

      expect(result).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('updates location fields', async () => {
      const location = await seedLocation(db);

      const result = await run(
        Effect.flatMap(LocationsService, (svc) =>
          svc.update(location.id, { name: 'Renamed Warehouse' } as any),
        ),
      );

      expect(result.name).toBe('Renamed Warehouse');
    });
  });

  describe('delete', () => {
    it('deletes a location', async () => {
      const location = await seedLocation(db);

      await run(
        Effect.flatMap(LocationsService, (svc) => svc.delete(location.id)),
      );

      const error = await fail(
        Effect.flatMap(LocationsService, (svc) => svc.findOne(location.id)),
      );
      expect(error._tag).toBe('LocationNotFound');
    });
  });

  describe('findAllPaginated', () => {
    it('paginates and filters by search', async () => {
      await seedLocation(db, { name: 'Central Depot' });
      await seedLocation(db, { name: 'North Depot' });
      await seedLocation(db, { name: 'Cold Storage' });

      const result = await run(
        Effect.flatMap(LocationsService, (svc) =>
          svc.findAllPaginated({ page: 1, limit: 10, search: 'Depot' } as any),
        ),
      );

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });
  });

  describe('existsById', () => {
    it('returns true for existing, false for missing', async () => {
      const location = await seedLocation(db);

      const [exists, missing] = await run(
        Effect.flatMap(LocationsService, (svc) =>
          Effect.all([
            svc.existsById(location.id),
            svc.existsById('00000000-0000-0000-0000-000000000000'),
          ]),
        ),
      );

      expect(exists).toBe(true);
      expect(missing).toBe(false);
    });
  });
});
