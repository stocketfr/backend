import { type Mock } from 'vitest';
import { Effect, Layer } from 'effect';
import { LocationsService } from './service';
import { LocationsRepository } from './repository';

const makeLocationEntity = (overrides: Record<string, any> = {}) => ({
  id: 'loc-1',
  name: 'Warehouse A',
  type: 'WAREHOUSE',
  address: '123 Main St',
  contact_person: 'John',
  phone: '555-0100',
  is_active: true,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
  ...overrides,
});

const makeMockRepository = (
  overrides: Record<string, Mock> = {},
) => ({
  findAllPaginated: vi.fn().mockReturnValue(
    Effect.succeed({
      data: [makeLocationEntity()],
      total: 1,
      page: 1,
      limit: 20,
      total_pages: 1,
    }),
  ),
  findAll: vi.fn().mockReturnValue(Effect.succeed([makeLocationEntity()])),
  findById: vi.fn().mockReturnValue(Effect.succeed(makeLocationEntity())),
  existsById: vi.fn().mockReturnValue(Effect.succeed(true)),
  create: vi.fn().mockReturnValue(Effect.succeed(makeLocationEntity())),
  update: vi.fn().mockReturnValue(Effect.succeed(makeLocationEntity())),
  delete: vi.fn().mockReturnValue(Effect.void),
  ...overrides,
});

const buildService = (repo = makeMockRepository()) =>
  Effect.runPromise(
    LocationsService.pipe(
      Effect.provide(
        LocationsService.DefaultWithoutDependencies.pipe(
          Layer.provide(
            Layer.succeed(LocationsRepository, repo as any),
          ),
        ),
      ),
    ),
  );

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe('Effect LocationsService', () => {
  it('returns paginated locations', async () => {
    const service = await buildService();
    const result = await run(
      service.findAllPaginated({ page: 1, limit: 20 } as any),
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'loc-1', name: 'Warehouse A' });
    expect(result.meta.total).toBe(1);
  });

  it('returns all locations (unpaginated)', async () => {
    const service = await buildService();
    const result = await run(service.findAll());

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'loc-1' });
  });

  it('returns a single location', async () => {
    const service = await buildService();
    const result = await run(service.findOne('loc-1'));

    expect(result).toMatchObject({ id: 'loc-1', name: 'Warehouse A' });
  });

  it('fails with LocationNotFound when location does not exist', async () => {
    const repo = makeMockRepository({
      findById: vi.fn().mockReturnValue(Effect.succeed(null)),
    });
    const service = await buildService(repo);

    const error = await Effect.runPromise(
      Effect.flip(service.findOne('missing')),
    );
    expect(error).toMatchObject({ _tag: 'LocationNotFound' });
  });

  it('creates a location with defaults', async () => {
    const repo = makeMockRepository();
    const service = await buildService(repo);

    await run(service.create({ name: 'New', type: 'WAREHOUSE' as any }));

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New',
        type: 'WAREHOUSE',
        address: '',
        contact_person: '',
        phone: '',
        is_active: true,
      }),
    );
  });

  it('returns current entity when update DTO is empty', async () => {
    const repo = makeMockRepository();
    const service = await buildService(repo);

    const result = await run(service.update('loc-1', {} as any));

    expect(result).toMatchObject({ id: 'loc-1' });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('updates and returns the updated row', async () => {
    const repo = makeMockRepository({
      update: vi
        .fn()
        .mockReturnValue(Effect.succeed(makeLocationEntity({ name: 'Updated' }))),
    });
    const service = await buildService(repo);

    const result = await run(
      service.update('loc-1', { name: 'Updated' } as any),
    );

    expect(repo.update).toHaveBeenCalledWith('loc-1', { name: 'Updated' });
    expect(result).toMatchObject({ name: 'Updated' });
  });

  it('deletes a location', async () => {
    const repo = makeMockRepository();
    const service = await buildService(repo);

    await run(service.delete('loc-1'));

    expect(repo.delete).toHaveBeenCalledWith('loc-1');
  });

  it('fails with LocationNotFound when deleting nonexistent location', async () => {
    const repo = makeMockRepository({
      findById: vi.fn().mockReturnValue(Effect.succeed(null)),
    });
    const service = await buildService(repo);

    const error = await Effect.runPromise(
      Effect.flip(service.delete('missing')),
    );
    expect(error).toMatchObject({ _tag: 'LocationNotFound' });
  });
});
