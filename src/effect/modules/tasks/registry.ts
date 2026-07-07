import { Effect } from 'effect';
import {
  requireProductImportAccess,
  requireSmartImportFeature,
} from '../products/import/access';
import { ProductImportTaskHandler } from './product-import-handler';
import { TaskHandlerNotFound } from './tasks.errors';
import type { TaskHandler, TaskTypeDto } from './types';

export type TaskAuthorizationAction = 'enqueue' | 'read' | 'cancel';

export class TaskRegistry extends Effect.Service<TaskRegistry>()(
  '@stocket/effect/tasks/TaskRegistry',
  {
    effect: Effect.gen(function* () {
      const productImportHandler = yield* ProductImportTaskHandler;

      const getHandler = (
        type: string,
      ): Effect.Effect<TaskHandler, TaskHandlerNotFound> => {
        if (type === 'product-import') {
          return Effect.succeed(productImportHandler);
        }

        return Effect.fail(
          new TaskHandlerNotFound({
            taskType: type,
            messageKey: 'tasks.handlerNotFound',
          }),
        );
      };

      const authorize = (
        type: TaskTypeDto,
        _action: TaskAuthorizationAction,
      ) => {
        switch (type) {
          case 'product-import':
            return requireProductImportAccess;
        }
      };

      const authorizeExecution = (type: TaskTypeDto) => {
        switch (type) {
          case 'product-import':
            return requireSmartImportFeature;
        }
      };

      return {
        authorize,
        authorizeExecution,
        getHandler,
      };
    }),
    dependencies: [ProductImportTaskHandler.Default],
  },
) {}
