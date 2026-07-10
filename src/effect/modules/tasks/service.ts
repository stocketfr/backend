import { Effect, Option } from 'effect';
import { toPaginatedResponse } from '@stocket/types/common';
import type {
  PaginatedTasksResponseDto,
  TaskQueryDto,
} from '@stocket/types/tasks';
import { fromNullOr } from '../../platform/effect/from-null-or';
import { getOptionalRequestContext } from '../../platform/http/request-context';
import {
  DEFAULT_LOCALE,
  type SupportedLocale,
} from '../../platform/observability/messages';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { toTaskResponseDto } from './mappers';
import { TasksRepository } from './repository';
import {
  TaskNotFound,
  TaskTerminalConflict,
  type TasksInfrastructureError,
} from './tasks.errors';
import { isTerminalTaskStatus } from './tasks.utils';
import type { EnqueueTaskOptions, TaskEnqueueResult } from './types';
import { TaskTerminalObserver } from './terminal-observer';

const currentLocale: Effect.Effect<SupportedLocale> = Effect.map(
  getOptionalRequestContext,
  Option.match({
    onNone: () => DEFAULT_LOCALE,
    onSome: (context) => context.locale,
  }),
);

export class TasksService extends Effect.Service<TasksService>()(
  '@stocket/effect/tasks/TasksService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* TasksRepository;
      const terminalObserver =
        yield* Effect.serviceOption(TaskTerminalObserver);
      const trace = makeServiceTracer({
        serviceName: 'TasksService',
        module: 'tasks',
        layer: 'service',
      });

      const enqueue = (
        options: EnqueueTaskOptions,
      ): Effect.Effect<
        TaskEnqueueResult,
        TasksInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const result = yield* repository.enqueue(options);
          return {
            task: toTaskResponseDto(result.task, yield* currentLocale),
            disposition: result.disposition,
          };
        }).pipe(trace.span('enqueue'));

      const findAllPaginated = (
        query: TaskQueryDto,
        actorId: string,
      ): Effect.Effect<
        PaginatedTasksResponseDto,
        TasksInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const result = yield* repository.findAllPaginatedForActor(
            query,
            actorId,
          );
          const locale = yield* currentLocale;
          return toPaginatedResponse(result, (task) =>
            toTaskResponseDto(task, locale),
          );
        }).pipe(
          trace.span('findAllPaginated', { attributes: { userId: actorId } }),
        );

      const findOne = (id: string, actorId: string) =>
        fromNullOr(
          repository.findByIdForActor(id, actorId),
          () => new TaskNotFound({ taskId: id, messageKey: 'tasks.notFound' }),
        ).pipe(
          Effect.flatMap((task) =>
            Effect.map(currentLocale, (locale) =>
              toTaskResponseDto(task, locale),
            ),
          ),
          trace.span('findOne', { attributes: { id, userId: actorId } }),
        );

      const cancel = (id: string, actorId: string) =>
        Effect.gen(function* () {
          const existing = yield* fromNullOr(
            repository.findByIdForActor(id, actorId),
            () =>
              new TaskNotFound({ taskId: id, messageKey: 'tasks.notFound' }),
          );
          yield* Effect.filterOrFail(
            Effect.succeed(existing),
            (task) => !isTerminalTaskStatus(task.status),
            () =>
              new TaskTerminalConflict({
                taskId: id,
                messageKey: 'tasks.terminalConflict',
              }),
          );
          const canceled = yield* fromNullOr(
            repository.requestCancellation(id, actorId),
            () =>
              new TaskTerminalConflict({
                taskId: id,
                messageKey: 'tasks.terminalConflict',
              }),
          );
          if (
            isTerminalTaskStatus(canceled.status) &&
            Option.isSome(terminalObserver)
          ) {
            yield* terminalObserver.value
              .onSettled({
                task: canceled,
                originalPayload: existing.payload,
              })
              .pipe(Effect.catchAllCause(() => Effect.void));
          }
          return toTaskResponseDto(canceled, yield* currentLocale);
        }).pipe(trace.span('cancel', { attributes: { id, userId: actorId } }));

      return { enqueue, findAllPaginated, findOne, cancel };
    }),
    dependencies: [TasksRepository.Default],
  },
) {}
