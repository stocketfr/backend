import { HttpRouter } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { TaskIdSchema, TaskQuerySchema } from '@stocket/types/tasks';
import {
  pathParams,
  queryParams,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { TasksService } from './service';

const TaskPathParamsSchema = Schema.Struct({ id: TaskIdSchema });

export const tasksRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    tenantRoute({
      decode: queryParams(TaskQuerySchema),
      session: 'required',
      handler: ({ input: query, session }) =>
        session
          ? Effect.flatMap(TasksService, (tasks) =>
              tasks.findAllPaginated(query, session.user.id),
            )
          : Effect.dieMessage('Required session missing for background tasks'),
    }),
  ),
  HttpRouter.get(
    '/:id',
    tenantRoute({
      decode: pathParams(TaskPathParamsSchema),
      session: 'required',
      handler: ({ input: { id }, session }) =>
        session
          ? Effect.flatMap(TasksService, (tasks) =>
              tasks.findOne(id, session.user.id),
            )
          : Effect.dieMessage('Required session missing for background tasks'),
    }),
  ),
  HttpRouter.post(
    '/:id/cancel',
    tenantRoute({
      decode: pathParams(TaskPathParamsSchema),
      session: 'required',
      handler: ({ input: { id }, session }) =>
        session
          ? Effect.flatMap(TasksService, (tasks) =>
              tasks.cancel(id, session.user.id),
            )
          : Effect.dieMessage('Required session missing for background tasks'),
    }),
  ),
  HttpRouter.prefixAll('/tasks'),
);
