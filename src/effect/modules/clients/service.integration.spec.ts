import { Effect, Layer } from 'effect';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
} from '../../testing/integration-layer';
import { seedClient } from '../../testing/seed';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { ClientsService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<ClientsService>;

beforeAll(() => {
  db = getTestDb();
  const dbLayer = makeTestDrizzleLayer();
  TestLayer = ClientsService.Default.pipe(Layer.provide(dbLayer));
});

afterAll(() => closeTestDb());
beforeEach(() => truncateAll());

const run = <A, E>(effect: Effect.Effect<A, E, ClientsService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const fail = <A, E>(effect: Effect.Effect<A, E, ClientsService>) =>
  Effect.runPromise(Effect.flip(effect.pipe(Effect.provide(TestLayer))));

describe('ClientsService Integration', () => {
  describe('create', () => {
    it('creates a client', async () => {
      const result = await run(
        Effect.flatMap(ClientsService, (svc) =>
          svc.create({
            company_name: 'Acme Corp',
            contact_person: 'Jane Doe',
            email: 'jane@acme.com',
          } as any),
        ),
      );

      expect(result.company_name).toBe('Acme Corp');
      expect(result.email).toBe('jane@acme.com');
    });

    it('rejects duplicate email', async () => {
      await seedClient(db, { email: 'dup@example.com' });

      const error = await fail(
        Effect.flatMap(ClientsService, (svc) =>
          svc.create({
            company_name: 'Other Corp',
            contact_person: 'Bob',
            email: 'dup@example.com',
          } as any),
        ),
      );

      expect(error._tag).toBe('ClientEmailAlreadyExists');
    });
  });

  describe('findOne', () => {
    it('returns a client by ID', async () => {
      const client = await seedClient(db, { company_name: 'FindMe Inc' });

      const result = await run(
        Effect.flatMap(ClientsService, (svc) => svc.findOne(client.id)),
      );

      expect(result.company_name).toBe('FindMe Inc');
    });

    it('fails for nonexistent client', async () => {
      const error = await fail(
        Effect.flatMap(ClientsService, (svc) =>
          svc.findOne('00000000-0000-0000-0000-000000000000'),
        ),
      );

      expect(error._tag).toBe('ClientNotFound');
    });
  });

  describe('update', () => {
    it('updates client fields', async () => {
      const client = await seedClient(db);

      const result = await run(
        Effect.flatMap(ClientsService, (svc) =>
          svc.update(client.id, { company_name: 'Updated Corp' } as any),
        ),
      );

      expect(result.company_name).toBe('Updated Corp');
    });

    it('rejects email change to existing email', async () => {
      await seedClient(db, { email: 'taken@example.com' });
      const client = await seedClient(db, { email: 'mine@example.com' });

      const error = await fail(
        Effect.flatMap(ClientsService, (svc) =>
          svc.update(client.id, { email: 'taken@example.com' } as any),
        ),
      );

      expect(error._tag).toBe('ClientEmailAlreadyExists');
    });
  });

  describe('delete', () => {
    it('deletes a client', async () => {
      const client = await seedClient(db);

      await run(Effect.flatMap(ClientsService, (svc) => svc.delete(client.id)));

      const error = await fail(
        Effect.flatMap(ClientsService, (svc) => svc.findOne(client.id)),
      );
      expect(error._tag).toBe('ClientNotFound');
    });
  });

  describe('findAllPaginated', () => {
    it('paginates and filters by search term', async () => {
      await seedClient(db, { company_name: 'Alpha Wines' });
      await seedClient(db, { company_name: 'Beta Spirits' });
      await seedClient(db, { company_name: 'Alpha Brewing' });

      const result = await run(
        Effect.flatMap(ClientsService, (svc) =>
          svc.findAllPaginated({ page: 1, limit: 10, q: 'Alpha' } as any),
        ),
      );

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });
  });

  describe('existsById', () => {
    it('returns true for existing, false for missing', async () => {
      const client = await seedClient(db);

      const [exists, missing] = await run(
        Effect.flatMap(ClientsService, (svc) =>
          Effect.all([
            svc.existsById(client.id),
            svc.existsById('00000000-0000-0000-0000-000000000000'),
          ]),
        ),
      );

      expect(exists).toBe(true);
      expect(missing).toBe(false);
    });
  });
});
