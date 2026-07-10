import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { TaskStatus } from '@stocket/types/tasks';
import { toRepositoryPaginatedResult } from '@stocket/types/common';
import {
  makeServiceTestHarness,
  makeTestLayer,
} from '../../testing/test-harness';
import { TasksRepository } from './repository';
import { TasksService } from './service';
import { makeTaskRow, TASK_ACTOR_ID, TASK_ID } from './__fixtures__/task';
import { TaskTerminalObserver } from './terminal-observer';

const serviceHarness = makeServiceTestHarness(
  TasksService,
  TasksService.DefaultWithoutDependencies,
);

describe('TasksService', () => {
  it.effect('preserves the enqueue disposition while mapping the task', () => {
    const repositoryLayer = makeTestLayer(TasksRepository)({
      enqueue: () =>
        Effect.succeed({
          task: makeTaskRow(),
          disposition: 'existing',
        }),
    });

    return serviceHarness.effect(repositoryLayer, (service) =>
      Effect.gen(function* () {
        const result = yield* service.enqueue({
          type: 'test-task',
          payload: { value: 'test' },
          createdBy: TASK_ACTOR_ID,
          idempotencyKey: 'request-1',
        });

        expect(result.disposition).toBe('existing');
        expect(result.task.id).toBe(TASK_ID);
      }),
    );
  });

  it.effect('scopes paginated reads to the requesting actor', () => {
    const findAllPaginatedForActor = vi.fn(() =>
      Effect.succeed(toRepositoryPaginatedResult([makeTaskRow()], 1, 1, 20)),
    );
    const repositoryLayer = makeTestLayer(TasksRepository)({
      findAllPaginatedForActor,
    });

    return serviceHarness.effect(repositoryLayer, (service) =>
      Effect.gen(function* () {
        const result = yield* service.findAllPaginated({}, TASK_ACTOR_ID);

        expect(findAllPaginatedForActor).toHaveBeenCalledWith(
          {},
          TASK_ACTOR_ID,
        );
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.id).toBe(TASK_ID);
      }),
    );
  });

  it.effect(
    'rejects cancellation after a task reaches a terminal state',
    () => {
      const requestCancellation = vi.fn(() =>
        Effect.succeed(makeTaskRow({ status: TaskStatus.CANCELED })),
      );
      const repositoryLayer = makeTestLayer(TasksRepository)({
        findByIdForActor: () =>
          Effect.succeed(makeTaskRow({ status: TaskStatus.SUCCEEDED })),
        requestCancellation,
      });

      return serviceHarness.effect(repositoryLayer, (service) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            service.cancel(TASK_ID, TASK_ACTOR_ID),
          );

          expect(error).toMatchObject({
            _tag: 'TaskTerminalConflict',
            taskId: TASK_ID,
          });
          expect(requestCancellation).not.toHaveBeenCalled();
        }),
      );
    },
  );

  it.effect('returns not found when another actor requests a task', () => {
    const repositoryLayer = makeTestLayer(TasksRepository)({
      findByIdForActor: () => Effect.succeed(null),
    });

    return serviceHarness.effect(repositoryLayer, (service) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          service.findOne(TASK_ID, 'another-user'),
        );
        expect(error).toMatchObject({ _tag: 'TaskNotFound', taskId: TASK_ID });
      }),
    );
  });

  it.effect('notifies an observer after queued cancellation settles', () => {
    const original = makeTaskRow({ payload: { blobKey: 'input.csv' } });
    const canceled = makeTaskRow({
      status: TaskStatus.CANCELED,
      payload: null,
      completed_at: new Date(),
    });
    const onSettled = vi.fn(() => Effect.void);
    const dependencies = Layer.mergeAll(
      makeTestLayer(TasksRepository)({
        findByIdForActor: () => Effect.succeed(original),
        requestCancellation: () => Effect.succeed(canceled),
      }),
      Layer.succeed(TaskTerminalObserver, { onSettled }),
    );

    return serviceHarness.effect(dependencies, (service) =>
      Effect.gen(function* () {
        yield* service.cancel(TASK_ID, TASK_ACTOR_ID);

        expect(onSettled).toHaveBeenCalledWith({
          task: canceled,
          originalPayload: { blobKey: 'input.csv' },
        });
      }),
    );
  });
});
