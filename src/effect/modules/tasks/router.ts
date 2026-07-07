import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { TaskIdSchema, TaskQuerySchema } from '@stocket/types/tasks';
import { respondJson, respondJsonOk } from '../../platform/http/errors';
import { TasksService } from './service';

const TaskPathParams = Schema.Struct({ id: TaskIdSchema });

export const tasksRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      const query =
        yield* HttpServerRequest.schemaSearchParams(TaskQuerySchema);
      const tasksService = yield* TasksService;
      return yield* respondJson(tasksService.findAllPaginated(query));
    }),
  ),
  HttpRouter.get(
    '/:id',
    Effect.gen(function* () {
      const { id } = yield* HttpRouter.schemaPathParams(TaskPathParams);
      const tasksService = yield* TasksService;
      return yield* respondJson(tasksService.findOne(id));
    }),
  ),
  HttpRouter.post(
    '/:id/cancel',
    Effect.gen(function* () {
      const { id } = yield* HttpRouter.schemaPathParams(TaskPathParams);
      const tasksService = yield* TasksService;
      const task = yield* tasksService.cancel(id);
      return yield* respondJsonOk(task);
    }),
  ),
  HttpRouter.prefixAll('/tasks'),
);
