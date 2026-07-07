import { Effect } from 'effect';
import { toPaginatedResponse } from '@stocket/types/common';
import type { TaskQueryDto, TaskTypeDto } from '@stocket/types/tasks';
import { fromNullOr } from '../../platform/effect/from-null-or';
import { TasksRepository } from './repository';
import { TaskRegistry } from './registry';
import { TaskNotFound } from './tasks.errors';
import type { EnqueueTaskParams } from './types';
import { toTaskResponseDto } from './utils';

export class TasksService extends Effect.Service<TasksService>()(
  '@stocket/effect/tasks/TasksService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* TasksRepository;
      const registry = yield* TaskRegistry;

      const enqueue = (params: EnqueueTaskParams) =>
        Effect.gen(function* () {
          yield* registry.authorize(params.type, 'enqueue');
          const task = yield* repository.enqueue(params);
          return toTaskResponseDto(task);
        }).pipe(Effect.withSpan('TasksService.enqueue'));

      const authorizeVisibleTypes = (query: TaskQueryDto) =>
        registry.authorize(
          (query.type ?? 'product-import') as TaskTypeDto,
          'read',
        );

      const findAllPaginated = (query: TaskQueryDto) =>
        Effect.gen(function* () {
          yield* authorizeVisibleTypes(query);
          const result = yield* repository.findAllPaginated(query);
          return toPaginatedResponse(result, toTaskResponseDto);
        }).pipe(Effect.withSpan('TasksService.findAllPaginated'));

      const findOne = (id: string) =>
        Effect.gen(function* () {
          const task = yield* fromNullOr(
            repository.findById(id),
            () =>
              new TaskNotFound({ taskId: id, messageKey: 'tasks.notFound' }),
          );
          yield* registry.authorize(task.type as TaskTypeDto, 'read');
          return toTaskResponseDto(task);
        }).pipe(
          Effect.withSpan('TasksService.findOne', { attributes: { id } }),
        );

      const cancel = (id: string) =>
        Effect.gen(function* () {
          const task = yield* fromNullOr(
            repository.findById(id),
            () =>
              new TaskNotFound({ taskId: id, messageKey: 'tasks.notFound' }),
          );
          yield* registry.authorize(task.type as TaskTypeDto, 'cancel');
          const canceled = yield* fromNullOr(
            repository.cancel(id),
            () =>
              new TaskNotFound({ taskId: id, messageKey: 'tasks.notFound' }),
          );
          return toTaskResponseDto(canceled);
        }).pipe(Effect.withSpan('TasksService.cancel', { attributes: { id } }));

      return {
        enqueue,
        findAllPaginated,
        findOne,
        cancel,
      };
    }),
    dependencies: [TasksRepository.Default, TaskRegistry.Default],
  },
) {}
