import { Context, Effect, Layer } from 'effect';
import type { TaskHandler } from './types';
import { TaskHandlerNotFound } from './worker.errors';

export interface TaskRegistryShape {
  readonly get: (
    taskType: string,
  ) => Effect.Effect<TaskHandler, TaskHandlerNotFound>;
}

export class TaskRegistry extends Context.Tag(
  '@stocket/effect/tasks/worker/TaskRegistry',
)<TaskRegistry, TaskRegistryShape>() {}

export const makeTaskRegistry = (
  handlers: ReadonlyArray<TaskHandler>,
): TaskRegistryShape => {
  const byType = new Map<string, TaskHandler>();
  for (const handler of handlers) {
    if (byType.has(handler.type)) {
      throw new Error(`Duplicate background task handler: ${handler.type}`);
    }
    byType.set(handler.type, handler);
  }

  return {
    get: (taskType) => {
      const handler = byType.get(taskType);
      return handler === undefined
        ? Effect.fail(new TaskHandlerNotFound({ taskType }))
        : Effect.succeed(handler);
    },
  };
};

export const makeTaskRegistryLayer = (handlers: ReadonlyArray<TaskHandler>) =>
  Layer.sync(TaskRegistry, () => makeTaskRegistry(handlers));

export const emptyTaskRegistryLayer = makeTaskRegistryLayer([]);
