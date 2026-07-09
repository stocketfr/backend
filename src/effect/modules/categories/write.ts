import { Effect } from 'effect';
import type {
  CreateCategoryDto,
  UpdateCategoryDto,
} from '@stocket/types/categories';
import { fromNullOr } from '../../platform/effect/from-null-or';
import {
  hasDefinedPatchValues,
  pickDefined,
} from '../../platform/effect/pick-defined';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import type { CategoriesRepository } from './repository';
import {
  type CategoriesInfrastructureError,
  CategoryCircularReference,
  CategoryNameAlreadyExists,
  CategoryNotFound,
  CategorySelfParent,
  ParentCategoryNotFound,
} from './categories.errors';
import type { Category } from './types';

export type CategoryWriteRepository = Pick<
  CategoriesRepository,
  | 'create'
  | 'delete'
  | 'existsById'
  | 'existsByName'
  | 'findById'
  | 'findOne'
  | 'update'
>;

const makeCategoryNotFound = (id: string) =>
  new CategoryNotFound({ id, messageKey: 'categories.notFound' });

const getCategoryOrFail = (repository: CategoryWriteRepository, id: string) =>
  fromNullOr(repository.findById(id), () => makeCategoryNotFound(id));

const checkForCycle = (
  repository: CategoryWriteRepository,
  categoryId: string,
  newParentId: string,
): Effect.Effect<
  boolean,
  CategoriesInfrastructureError | TenantNotResolved
> =>
  Effect.gen(function* () {
    let currentId: string | null = newParentId;

    while (currentId) {
      if (currentId === categoryId) {
        return true;
      }

      const parent: Category | null = yield* repository.findOne({
        id: currentId,
      });

      currentId = parent?.parent_id ?? null;
    }

    return false;
  });

interface CategoryWriteWorkflowOptions {
  readonly repository: CategoryWriteRepository;
}

export const makeCategoryWriteWorkflows = ({
  repository,
}: CategoryWriteWorkflowOptions) => {
  const create = (
    dto: CreateCategoryDto,
  ): Effect.Effect<
    Category,
    | CategoriesInfrastructureError
    | CategoryNameAlreadyExists
    | ParentCategoryNotFound
    | TenantNotResolved
  > =>
    Effect.gen(function* () {
      if (dto.parent_id) {
        const parentExists = yield* repository.existsById(dto.parent_id);
        if (!parentExists) {
          return yield* Effect.fail(
            new ParentCategoryNotFound({
              parentId: dto.parent_id,
              messageKey: 'categories.parentNotFound',
            }),
          );
        }
      }

      const nameExists = yield* repository.existsByName(
        dto.name,
        dto.parent_id,
      );
      if (nameExists) {
        return yield* Effect.fail(
          new CategoryNameAlreadyExists({
            name: dto.name,
            parentId: dto.parent_id,
            messageKey: 'categories.nameAlreadyExists',
          }),
        );
      }

      return yield* repository.create({
        name: dto.name,
        parent_id: dto.parent_id ?? null,
        description: dto.description ?? null,
      });
    });

  const update = (
    id: string,
    dto: UpdateCategoryDto,
  ): Effect.Effect<
    Category,
    | CategoriesInfrastructureError
    | CategoryCircularReference
    | CategoryNameAlreadyExists
    | CategoryNotFound
    | CategorySelfParent
    | ParentCategoryNotFound
    | TenantNotResolved
  > =>
    Effect.gen(function* () {
      const category = yield* getCategoryOrFail(repository, id);

      if (dto.parent_id !== undefined) {
        if (dto.parent_id === id) {
          return yield* Effect.fail(
            new CategorySelfParent({
              id,
              messageKey: 'categories.selfParent',
            }),
          );
        }

        if (dto.parent_id) {
          const parentExists = yield* repository.existsById(dto.parent_id);
          if (!parentExists) {
            return yield* Effect.fail(
              new ParentCategoryNotFound({
                parentId: dto.parent_id,
                messageKey: 'categories.parentNotFound',
              }),
            );
          }

          const wouldCreateCycle = yield* checkForCycle(
            repository,
            id,
            dto.parent_id,
          );
          if (wouldCreateCycle) {
            return yield* Effect.fail(
              new CategoryCircularReference({
                id,
                parentId: dto.parent_id,
                messageKey: 'categories.circularReference',
              }),
            );
          }
        }
      }

      const targetName = dto.name ?? category.name;
      const targetParentId =
        dto.parent_id !== undefined ? dto.parent_id : category.parent_id;

      if (
        targetName !== category.name ||
        targetParentId !== category.parent_id
      ) {
        const nameExists = yield* repository.existsByName(
          targetName,
          targetParentId,
        );
        if (nameExists) {
          return yield* Effect.fail(
            new CategoryNameAlreadyExists({
              name: targetName,
              parentId: targetParentId,
              messageKey: 'categories.nameAlreadyExists',
            }),
          );
        }
      }

      const updateData = pickDefined<Category>([
        ['name', dto.name],
        ['parent_id', dto.parent_id],
        ['description', dto.description],
      ]);

      if (!hasDefinedPatchValues(updateData)) {
        return category;
      }

      return yield* fromNullOr(
        repository.update(id, updateData),
        () => makeCategoryNotFound(id),
      );
    });

  const remove = (
    id: string,
  ): Effect.Effect<
    void,
    CategoriesInfrastructureError | CategoryNotFound | TenantNotResolved
  > =>
    Effect.gen(function* () {
      yield* getCategoryOrFail(repository, id);
      yield* repository.delete(id);
    });

  return {
    create,
    update,
    delete: remove,
  };
};
