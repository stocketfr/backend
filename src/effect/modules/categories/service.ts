import { Effect } from 'effect';
import type { CategoryWithChildrenResponseDto, CreateCategoryDto, UpdateCategoryDto } from '@stocket/types/categories';
import { fromNullOr } from '../../platform/from-null-or';
import type { categories } from '../../platform/db/schema';
import {
  type CategoriesInfrastructureError,
  CategoryCircularReference,
  CategoryNameAlreadyExists,
  CategoryNotFound,
  CategorySelfParent,
  ParentCategoryNotFound,
} from './categories.errors';
import type { TenantNotResolved } from '../../platform/tenant-context';
import { CategoriesRepository } from './repository';

type Category = typeof categories.$inferSelect;

const buildTree = (categories: Category[]): CategoryWithChildrenResponseDto[] => {
  const categoryMap = new Map<string, CategoryWithChildrenResponseDto>();
  const roots: CategoryWithChildrenResponseDto[] = [];

  for (const category of categories) {
    categoryMap.set(category.id, {
      id: category.id,
      name: category.name,
      parent_id: category.parent_id,
      description: category.description,
      created_at: category.created_at,
      updated_at: category.updated_at,
      children: [],
    });
  }

  for (const category of categories) {
    const node = categoryMap.get(category.id)!;

    if (category.parent_id && categoryMap.has(category.parent_id)) {
      const parent = categoryMap.get(category.parent_id)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
};

export class CategoriesService extends Effect.Service<CategoriesService>()(
  '@stocket/effect/categories/CategoriesService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* CategoriesRepository;

      const getCategoryOrFail = (id: string) =>
        fromNullOr(repository.findById(id), () =>
          new CategoryNotFound({ id, messageKey: 'categories.notFound' }),
        );

      const checkForCycle = (
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

      const findAll = () =>
        Effect.map(
          repository.findAll(),
          (categories) => buildTree(categories),
        ).pipe(Effect.withSpan('CategoriesService.findAll'));

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

          const nameExists = yield* repository.existsByName(dto.name, dto.parent_id);
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
        }).pipe(Effect.withSpan('CategoriesService.create'));

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
          const category = yield* getCategoryOrFail(id);

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

              const wouldCreateCycle = yield* checkForCycle(id, dto.parent_id);
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
            const nameExists = yield* repository.existsByName(targetName, targetParentId);
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

          const updateData: Partial<Category> = {};
          if (dto.name !== undefined) updateData.name = dto.name;
          if (dto.parent_id !== undefined) updateData.parent_id = dto.parent_id;
          if (dto.description !== undefined)
            updateData.description = dto.description;

          if (Object.keys(updateData).length === 0) {
            return category;
          }

          return yield* fromNullOr(
            repository.update(id, updateData),
            () => new CategoryNotFound({ id, messageKey: 'categories.notFound' }),
          );
        }).pipe(Effect.withSpan('CategoriesService.update', { attributes: { id } }));

      const remove = (
        id: string,
      ): Effect.Effect<
        void,
        CategoriesInfrastructureError | CategoryNotFound | TenantNotResolved
      > =>
        Effect.gen(function* () {
          yield* getCategoryOrFail(id);
          yield* repository.delete(id);
        }).pipe(Effect.withSpan('CategoriesService.delete', { attributes: { id } }));

      const existsById = (id: string) =>
        repository.existsById(id).pipe(
          Effect.withSpan('CategoriesService.existsById', { attributes: { id } }),
        );

      const findAllDescendantIds = (parentId: string) =>
        repository.findAllDescendantIds(parentId).pipe(
          Effect.withSpan('CategoriesService.findAllDescendantIds', { attributes: { parentId } }),
        );

      return {
        findAll,
        create,
        update,
        delete: remove,
        existsById,
        findAllDescendantIds,
      };
    }),
    dependencies: [CategoriesRepository.Default],
  },
) {}
