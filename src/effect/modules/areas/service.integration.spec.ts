import { Effect, Layer } from 'effect';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
} from '../../test/integration-layer';
import { seedLocation, seedArea } from '../../test/seed';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { AreasService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<AreasService>;

beforeAll(() => {
  db = getTestDb();
  const dbLayer = makeTestDrizzleLayer();
  TestLayer = AreasService.Default.pipe(Layer.provide(dbLayer));
});

afterAll(() => closeTestDb());
beforeEach(() => truncateAll());

const run = <A, E>(effect: Effect.Effect<A, E, AreasService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const fail = <A, E>(effect: Effect.Effect<A, E, AreasService>) =>
  Effect.runPromise(Effect.flip(effect.pipe(Effect.provide(TestLayer))));

describe('AreasService Integration', () => {
  describe('create', () => {
    it('creates an area under a location', async () => {
      const location = await seedLocation(db);

      const result = await run(
        Effect.flatMap(AreasService, (svc) =>
          svc.create({ name: 'Cold Storage', location_id: location.id } as any),
        ),
      );

      expect(result.name).toBe('Cold Storage');
      expect(result.location_id).toBe(location.id);
    });

    it('creates a child area under a parent', async () => {
      const location = await seedLocation(db);
      const parent = await seedArea(db, { location_id: location.id, name: 'Aisle A' });

      const result = await run(
        Effect.flatMap(AreasService, (svc) =>
          svc.create({
            name: 'Shelf 1',
            location_id: location.id,
            parent_id: parent.id,
          } as any),
        ),
      );

      expect(result.parent_id).toBe(parent.id);
    });

    it('rejects parent area from different location', async () => {
      const locA = await seedLocation(db, { name: 'Warehouse A' });
      const locB = await seedLocation(db, { name: 'Warehouse B' });
      const parentInB = await seedArea(db, { location_id: locB.id, name: 'Aisle B' });

      const error = await fail(
        Effect.flatMap(AreasService, (svc) =>
          svc.create({
            name: 'Shelf in A',
            location_id: locA.id,
            parent_id: parentInB.id,
          } as any),
        ),
      );

      expect(error._tag).toBe('AreaParentLocationMismatch');
    });

    it('rejects nonexistent location', async () => {
      const error = await fail(
        Effect.flatMap(AreasService, (svc) =>
          svc.create({
            name: 'Nowhere',
            location_id: '00000000-0000-0000-0000-000000000000',
          } as any),
        ),
      );

      expect(error._tag).toBe('AreaLocationNotFound');
    });
  });

  describe('update', () => {
    it('rejects self-parent', async () => {
      const location = await seedLocation(db);
      const area = await seedArea(db, { location_id: location.id });

      const error = await fail(
        Effect.flatMap(AreasService, (svc) =>
          svc.update(area.id, { parent_id: area.id } as any),
        ),
      );

      expect(error._tag).toBe('AreaSelfParent');
    });

    it('detects circular reference', async () => {
      const location = await seedLocation(db);
      const gp = await seedArea(db, { location_id: location.id, name: 'GP' });
      const parent = await seedArea(db, { location_id: location.id, name: 'P', parent_id: gp.id });
      const child = await seedArea(db, { location_id: location.id, name: 'C', parent_id: parent.id });

      const error = await fail(
        Effect.flatMap(AreasService, (svc) =>
          svc.update(gp.id, { parent_id: child.id } as any),
        ),
      );

      expect(error._tag).toBe('AreaCircularReference');
    });
  });

  describe('findById / findByIdWithChildren', () => {
    it('findById returns area with location', async () => {
      const location = await seedLocation(db, { name: 'Main Warehouse' });
      const area = await seedArea(db, { location_id: location.id, name: 'Dock' });

      const result = await run(
        Effect.flatMap(AreasService, (svc) => svc.findById(area.id)),
      );

      expect(result.name).toBe('Dock');
      expect(result.location_id).toBe(location.id);
    });

    it('findByIdWithChildren includes direct children', async () => {
      const location = await seedLocation(db);
      const parent = await seedArea(db, { location_id: location.id, name: 'Aisle' });
      await seedArea(db, { location_id: location.id, name: 'Shelf 1', parent_id: parent.id });
      await seedArea(db, { location_id: location.id, name: 'Shelf 2', parent_id: parent.id });

      const result = await run(
        Effect.flatMap(AreasService, (svc) => svc.findByIdWithChildren(parent.id)),
      );

      expect(result.name).toBe('Aisle');
      expect(result.children).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('deletes an area', async () => {
      const location = await seedLocation(db);
      const area = await seedArea(db, { location_id: location.id });

      await run(
        Effect.flatMap(AreasService, (svc) => svc.delete(area.id)),
      );

      const error = await fail(
        Effect.flatMap(AreasService, (svc) => svc.findById(area.id)),
      );
      expect(error._tag).toBe('AreaNotFound');
    });
  });
});
