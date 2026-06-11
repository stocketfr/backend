import { type Mock } from 'vitest';
import { Effect, Layer } from 'effect';
import { SuppliersService } from './service';
import { SuppliersRepository } from './repository';

const makeSupplierEntity = (overrides: Record<string, any> = {}) => ({
  id: 'supplier-1',
  name: 'Best Supplies',
  contact_person: null,
  email: null,
  phone: null,
  address: null,
  website: null,
  notes: null,
  is_active: true,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
  ...overrides,
});

const makeMockRepository = (
  overrides: Partial<Record<string, Mock>> = {},
) => ({
  findAllPaginated: vi.fn().mockReturnValue(
    Effect.succeed({
      data: [makeSupplierEntity()],
      total: 1,
      page: 1,
      limit: 20,
      total_pages: 1,
    }),
  ),
  findById: vi.fn().mockReturnValue(Effect.succeed(makeSupplierEntity())),
  existsById: vi.fn().mockReturnValue(Effect.succeed(true)),
  create: vi.fn().mockReturnValue(Effect.succeed(makeSupplierEntity())),
  update: vi.fn().mockReturnValue(Effect.succeed(makeSupplierEntity())),
  delete: vi.fn().mockReturnValue(Effect.void),
  ...overrides,
});

const buildService = (repo = makeMockRepository()) =>
  Effect.runPromise(
    SuppliersService.pipe(
      Effect.provide(
        SuppliersService.DefaultWithoutDependencies.pipe(
          Layer.provide(Layer.succeed(SuppliersRepository, repo as any)),
        ),
      ),
    ),
  );

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const fail = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(effect));

describe('Effect SuppliersService', () => {
  describe('findAllPaginated', () => {
    it('returns paginated suppliers', async () => {
      const service = await buildService();
      const result = await run(service.findAllPaginated({ page: 1, limit: 20 }));
      expect(result.data).toHaveLength(1);
      expect(result.meta).toMatchObject({ page: 1, total: 1 });
    });
  });

  describe('findOne', () => {
    it('returns a supplier', async () => {
      const service = await buildService();
      const result = await run(service.findOne('supplier-1'));
      expect(result).toMatchObject({ id: 'supplier-1', name: 'Best Supplies' });
    });

    it('fails with SupplierNotFound', async () => {
      const repo = makeMockRepository({ findById: vi.fn().mockReturnValue(Effect.succeed(null)) });
      const service = await buildService(repo);
      const error = await fail(service.findOne('missing'));
      expect(error).toMatchObject({ _tag: 'SupplierNotFound' });
    });
  });

  describe('create', () => {
    it('creates a supplier', async () => {
      const service = await buildService();
      const result = await run(service.create({ name: 'Best Supplies' } as any));
      expect(result).toMatchObject({ id: 'supplier-1' });
    });
  });

  describe('update', () => {
    it('updates a supplier', async () => {
      const service = await buildService();
      const result = await run(
        service.update('supplier-1', { name: 'Updated' } as any),
      );
      expect(result).toMatchObject({ id: 'supplier-1' });
    });

    it('returns current entity on empty update', async () => {
      const repo = makeMockRepository();
      const service = await buildService(repo);
      await run(service.update('supplier-1', {} as any));
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes a supplier', async () => {
      const repo = makeMockRepository();
      const service = await buildService(repo);
      await run(service.delete('supplier-1'));
      expect(repo.delete).toHaveBeenCalledWith('supplier-1');
    });

    it('fails with SupplierNotFound', async () => {
      const repo = makeMockRepository({ findById: vi.fn().mockReturnValue(Effect.succeed(null)) });
      const service = await buildService(repo);
      const error = await fail(service.delete('missing'));
      expect(error).toMatchObject({ _tag: 'SupplierNotFound' });
    });
  });

  describe('existsById', () => {
    it('delegates to repository', async () => {
      const repo = makeMockRepository();
      const service = await buildService(repo);
      const result = await Effect.runPromise(service.existsById('supplier-1'));
      expect(result).toBe(true);
    });
  });
});
