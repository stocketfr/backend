import { Effect } from 'effect';
import type {
  CreateCategoryDto,
  UpdateCategoryDto,
} from '@stocket/types/categories';
import {
  makeEnsureExistByIds,
  makeEnsureExistsById,
} from '../../platform/effect/existence';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { CategoryNotFound } from './categories.errors';
import { buildCategoryTree } from './mappers';
import { CategoriesRepository } from './repository';
import { makeCategoryWriteWorkflows } from './write';

export class CategoriesService extends Effect.Service<CategoriesService>()(
  '@stocket/effect/categories/CategoriesService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* CategoriesRepository;
      const trace = makeServiceTracer({
        serviceName: 'CategoriesService',
        module: 'categories',
        layer: 'service',
      });

      const makeCategoryNotFound = (id: string) =>
        new CategoryNotFound({ id, messageKey: 'categories.notFound' });

      const categoryWriteWorkflows = makeCategoryWriteWorkflows({
        repository,
      });

      const findAll = () =>
        Effect.map(repository.findAll(), (categories) =>
          buildCategoryTree(categories),
        ).pipe(trace.span('findAll'));

      const create = (dto: CreateCategoryDto) =>
        categoryWriteWorkflows.create(dto).pipe(trace.span('create'));

      const update = (id: string, dto: UpdateCategoryDto) =>
        categoryWriteWorkflows
          .update(id, dto)
          .pipe(trace.span('update', { attributes: { id } }));

      const remove = (id: string) =>
        categoryWriteWorkflows
          .delete(id)
          .pipe(trace.span('delete', { attributes: { id } }));

      const existsById = (id: string) =>
        repository
          .existsById(id)
          .pipe(trace.span('existsById', { attributes: { id } }));

      const ensureExistsById = (id: string) =>
        makeEnsureExistsById(
          repository.existsById,
          makeCategoryNotFound,
        )(id).pipe(trace.span('ensureExistsById', { attributes: { id } }));

      const ensureExistByIds = (ids: readonly string[]) =>
        makeEnsureExistByIds(
          repository.findByIds,
          makeCategoryNotFound,
        )(ids).pipe(trace.span('ensureExistByIds'));

      const findAllDescendantIds = (parentId: string) =>
        repository
          .findAllDescendantIds(parentId)
          .pipe(
            trace.span('findAllDescendantIds', { attributes: { parentId } }),
          );

      return {
        findAll,
        create,
        update,
        delete: remove,
        existsById,
        ensureExistsById,
        ensureExistByIds,
        findAllDescendantIds,
      };
    }),
    dependencies: [CategoriesRepository.Default],
  },
) {}
