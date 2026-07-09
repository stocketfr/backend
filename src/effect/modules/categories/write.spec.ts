import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  makeCategoryWriteWorkflows,
  type CategoryWriteRepository,
} from './write';
import type { Category } from './types';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-01-01T00:00:00.000Z');

type CategoryCreateData = Parameters<CategoryWriteRepository['create']>[0];
type CategoryUpdateData = Parameters<CategoryWriteRepository['update']>[1];

const makeCategory = (overrides: Partial<Category> = {}): Category => ({
  id: 'cat-1',
  tenant_id: TENANT_ID,
  name: 'Electronics',
  parent_id: null,
  description: 'Electronic goods',
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
});

const makeRepository = (
  overrides: Partial<CategoryWriteRepository> = {},
): CategoryWriteRepository => ({
  create: () => Effect.succeed(makeCategory()),
  delete: () => Effect.void,
  existsById: () => Effect.succeed(true),
  existsByName: () => Effect.succeed(false),
  findById: () => Effect.succeed(makeCategory()),
  findOne: () => Effect.succeed(null),
  update: () => Effect.succeed(makeCategory()),
  ...overrides,
});

describe('makeCategoryWriteWorkflows', () => {
  it.effect('creates a category after parent and name checks', () =>
    Effect.gen(function* () {
      let parentChecked: string | undefined;
      let nameCheck:
        | { readonly name: string; readonly parentId: string | null | undefined }
        | undefined;
      let capturedCreate: CategoryCreateData | undefined;
      const repository = makeRepository({
        existsById: (id) =>
          Effect.sync(() => {
            parentChecked = id;
            return true;
          }),
        existsByName: (name, parentId) =>
          Effect.sync(() => {
            nameCheck = { name, parentId };
            return false;
          }),
        create: (data) =>
          Effect.sync(() => {
            capturedCreate = data;
            return makeCategory({
              id: 'cat-new',
              name: data.name,
              parent_id: data.parent_id,
              description: data.description,
            });
          }),
      });
      const workflows = makeCategoryWriteWorkflows({ repository });

      const result = yield* workflows.create({
        name: 'Laptops',
        parent_id: 'cat-parent',
        description: 'Portable computers',
      });

      expect(parentChecked).toBe('cat-parent');
      expect(nameCheck).toEqual({
        name: 'Laptops',
        parentId: 'cat-parent',
      });
      expect(capturedCreate).toEqual({
        name: 'Laptops',
        parent_id: 'cat-parent',
        description: 'Portable computers',
      });
      expect(result).toMatchObject({
        id: 'cat-new',
        name: 'Laptops',
      });
    }),
  );

  it.effect('rejects duplicate category names in the target parent scope', () =>
    Effect.gen(function* () {
      const repository = makeRepository({
        existsByName: () => Effect.succeed(true),
      });
      const workflows = makeCategoryWriteWorkflows({ repository });

      const error = yield* Effect.flip(
        workflows.create({ name: 'Electronics' }),
      );

      expect(error).toMatchObject({
        _tag: 'CategoryNameAlreadyExists',
        name: 'Electronics',
      });
    }),
  );

  it.effect('updates a category after validating parent moves and cycles', () =>
    Effect.gen(function* () {
      let capturedUpdate: CategoryUpdateData | undefined;
      const repository = makeRepository({
        findById: () =>
          Effect.succeed(makeCategory({ id: 'cat-1', parent_id: null })),
        findOne: ({ id }) =>
          Effect.succeed(
            id === 'cat-parent'
              ? makeCategory({ id: 'cat-parent', parent_id: null })
              : null,
          ),
        update: (_id, data) =>
          Effect.sync(() => {
            capturedUpdate = data;
            return makeCategory({ ...data });
          }),
      });
      const workflows = makeCategoryWriteWorkflows({ repository });

      const result = yield* workflows.update('cat-1', {
        name: 'Updated',
        parent_id: 'cat-parent',
      });

      expect(capturedUpdate).toEqual({
        name: 'Updated',
        parent_id: 'cat-parent',
      });
      expect(result).toMatchObject({
        name: 'Updated',
        parent_id: 'cat-parent',
      });
    }),
  );

  it.effect('detects circular parent references', () =>
    Effect.gen(function* () {
      const repository = makeRepository({
        findById: () =>
          Effect.succeed(makeCategory({ id: 'cat-1', parent_id: null })),
        findOne: ({ id }) =>
          Effect.succeed(
            id === 'cat-child'
              ? makeCategory({ id: 'cat-child', parent_id: 'cat-1' })
              : null,
          ),
      });
      const workflows = makeCategoryWriteWorkflows({ repository });

      const error = yield* Effect.flip(
        workflows.update('cat-1', { parent_id: 'cat-child' }),
      );

      expect(error).toMatchObject({
        _tag: 'CategoryCircularReference',
        id: 'cat-1',
        parentId: 'cat-child',
      });
    }),
  );

  it.effect('returns the existing category without writing an empty update', () =>
    Effect.gen(function* () {
      let updateCalled = false;
      const repository = makeRepository({
        update: () =>
          Effect.sync(() => {
            updateCalled = true;
            return makeCategory();
          }),
      });
      const workflows = makeCategoryWriteWorkflows({ repository });

      const result = yield* workflows.update('cat-1', {});

      expect(updateCalled).toBe(false);
      expect(result).toMatchObject({ id: 'cat-1' });
    }),
  );

  it.effect('deletes only after the category exists', () =>
    Effect.gen(function* () {
      let deletedId: string | undefined;
      const repository = makeRepository({
        delete: (id) =>
          Effect.sync(() => {
            deletedId = id;
          }),
      });
      const workflows = makeCategoryWriteWorkflows({ repository });

      yield* workflows.delete('cat-1');

      expect(deletedId).toBe('cat-1');
    }),
  );
});
