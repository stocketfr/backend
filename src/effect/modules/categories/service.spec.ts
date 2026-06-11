import { type Mock } from 'vitest';
import { Effect, Layer } from 'effect';
import { CategoriesService } from './service';
import { CategoriesRepository } from './repository';

const makeCategoryEntity = (overrides: Record<string, any> = {}) => ({
  id: 'cat-1',
  tenant_id: '00000000-0000-4000-8000-000000000001',
  name: 'Electronics',
  parent_id: null,
  description: 'Electronic goods',
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
  ...overrides,
});

const makeMockRepository = (overrides: Record<string, Mock> = {}) => ({
  findAll: vi.fn().mockReturnValue(Effect.succeed([makeCategoryEntity()])),
  findById: vi.fn().mockReturnValue(Effect.succeed(makeCategoryEntity())),
  existsById: vi.fn().mockReturnValue(Effect.succeed(true)),
  existsByName: vi.fn().mockReturnValue(Effect.succeed(false)),
  create: vi.fn().mockReturnValue(Effect.succeed(makeCategoryEntity())),
  update: vi.fn().mockReturnValue(Effect.succeed(makeCategoryEntity())),
  delete: vi.fn().mockReturnValue(Effect.void),
  findOne: vi.fn().mockReturnValue(Effect.succeed(null)),
  findAllDescendantIds: vi.fn().mockReturnValue(Effect.succeed([])),
  ...overrides,
});

const buildService = (repo = makeMockRepository()) =>
  Effect.runPromise(
    CategoriesService.pipe(
      Effect.provide(
        CategoriesService.DefaultWithoutDependencies.pipe(
          Layer.provide(Layer.succeed(CategoriesRepository, repo as any)),
        ),
      ),
    ),
  );

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const fail = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(effect));

describe('Effect CategoriesService', () => {
  describe('findAll (tree)', () => {
    it('builds a tree from flat categories', async () => {
      const repo = makeMockRepository({
        findAll: vi.fn().mockReturnValue(
          Effect.succeed([
            makeCategoryEntity({ id: 'cat-1', name: 'Root', parent_id: null }),
            makeCategoryEntity({
              id: 'cat-2',
              name: 'Child',
              parent_id: 'cat-1',
            }),
          ]),
        ),
      });
      const service = await buildService(repo);
      const result = await run(service.findAll());

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('Root');
      expect(result[0]!.children).toHaveLength(1);
      expect(result[0]!.children[0]!.name).toBe('Child');
    });

    it('returns empty array for no categories', async () => {
      const repo = makeMockRepository({
        findAll: vi.fn().mockReturnValue(Effect.succeed([])),
      });
      const service = await buildService(repo);
      const result = await run(service.findAll());

      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('creates a category', async () => {
      const service = await buildService();
      const result = await run(
        service.create({ name: 'New', permissions: [] } as any),
      );

      expect(result).toMatchObject({ id: 'cat-1' });
    });

    it('validates parent existence', async () => {
      const repo = makeMockRepository({
        existsById: vi.fn().mockReturnValue(Effect.succeed(false)),
      });
      const service = await buildService(repo);

      const error = await fail(
        service.create({
          name: 'Child',
          parent_id: 'missing-parent',
        } as any),
      );

      expect(error).toMatchObject({ _tag: 'ParentCategoryNotFound' });
    });

    it('rejects duplicate name in same scope', async () => {
      const repo = makeMockRepository({
        existsByName: vi.fn().mockReturnValue(Effect.succeed(true)),
      });
      const service = await buildService(repo);

      const error = await fail(service.create({ name: 'Electronics' } as any));

      expect(error).toMatchObject({ _tag: 'CategoryNameAlreadyExists' });
    });
  });

  describe('update', () => {
    it('updates a category', async () => {
      const repo = makeMockRepository({
        update: vi
          .fn()
          .mockReturnValue(
            Effect.succeed(makeCategoryEntity({ name: 'Updated' })),
          ),
      });
      const service = await buildService(repo);

      const result = await run(service.update('cat-1', { name: 'Updated' }));

      expect(result).toMatchObject({ name: 'Updated' });
    });

    it('rejects self-parent', async () => {
      const service = await buildService();

      const error = await fail(service.update('cat-1', { parent_id: 'cat-1' }));

      expect(error).toMatchObject({ _tag: 'CategorySelfParent' });
    });

    it('detects circular references', async () => {
      const repo = makeMockRepository({
        findById: vi.fn().mockReturnValue(Effect.succeed(makeCategoryEntity())),
        findOne: vi
          .fn()
          .mockReturnValueOnce(Effect.succeed({ parent_id: 'cat-1' })),
      });
      const service = await buildService(repo);

      const error = await fail(service.update('cat-1', { parent_id: 'cat-3' }));

      expect(error).toMatchObject({ _tag: 'CategoryCircularReference' });
    });

    it('returns current category when no fields to update', async () => {
      const repo = makeMockRepository();
      const service = await buildService(repo);

      const result = await run(service.update('cat-1', {}));

      expect(result).toMatchObject({ id: 'cat-1' });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('fails with CategoryNotFound', async () => {
      const repo = makeMockRepository({
        findById: vi.fn().mockReturnValue(Effect.succeed(null)),
      });
      const service = await buildService(repo);

      const error = await fail(service.update('missing', { name: 'X' }));
      expect(error).toMatchObject({ _tag: 'CategoryNotFound' });
    });
  });

  describe('delete', () => {
    it('deletes a category', async () => {
      const repo = makeMockRepository();
      const service = await buildService(repo);

      await run(service.delete('cat-1'));

      expect(repo.delete).toHaveBeenCalledWith('cat-1');
    });

    it('fails with CategoryNotFound', async () => {
      const repo = makeMockRepository({
        findById: vi.fn().mockReturnValue(Effect.succeed(null)),
      });
      const service = await buildService(repo);

      const error = await fail(service.delete('missing'));
      expect(error).toMatchObject({ _tag: 'CategoryNotFound' });
    });
  });
});
