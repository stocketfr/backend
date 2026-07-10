import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { TaskStatus } from '@stocket/types/tasks';
import { toRepositoryPaginatedResult } from '@stocket/types/common';
import {
  makeServiceTestHarness,
  makeTestLayer,
} from '../../testing/test-harness';
import { TasksRepository } from './repository';
import { TasksService } from './service';
import { makeTaskRow, TASK_ACTOR_ID, TASK_ID } from './__fixtures__/task';

const serviceHarness = makeServiceTestHarness(
  TasksService,
  TasksService.DefaultWithoutDependencies,
);

describe('TasksService', () => {
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
});
