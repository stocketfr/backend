import { type Context, Effect } from 'effect';
import { TaskStatus, type TaskResponseDto } from '@stocket/types/tasks';
import {
  makeFakeSession,
  makeRouterServiceLayer,
  makeRouterTestHarness,
} from '../../testing/router-harness';
import { tasksRouter } from './router';
import { TasksService } from './service';
import { TASK_ACTOR_ID, TASK_ID } from './__fixtures__/task';

vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');
  return {
    TasksService: Context.GenericTag('@stocket/test/TasksService'),
    tasksLayer: Layer.empty,
  };
});

const now = new Date('2026-07-10T10:00:00.000Z');

const makeTaskResponse = (): TaskResponseDto => ({
  id: TASK_ID,
  type: 'test-task',
  status: TaskStatus.QUEUED,
  result: null,
  error: null,
  attempt_count: 0,
  max_attempts: 3,
  run_after: now,
  progress: {
    total: null,
    processed: 0,
    failed: 0,
    percent: null,
    message: null,
    message_key: null,
    message_args: null,
  },
  cancel_requested_at: null,
  started_at: null,
  completed_at: null,
  created_at: now,
  updated_at: now,
});

const makeHandler = (
  service: Partial<Context.Tag.Service<typeof TasksService>>,
  authenticated = true,
) =>
  makeRouterTestHarness({
    router: tasksRouter,
    layers: [makeRouterServiceLayer(TasksService, service)],
    provideBetterAuth: true,
    session: authenticated ? makeFakeSession(TASK_ACTOR_ID) : null,
  }).handler;

describe('tasksRouter', () => {
  it('passes the session actor to task listing', async () => {
    const findAllPaginated = vi.fn(() =>
      Effect.succeed({
        data: [makeTaskResponse()],
        meta: {
          page: 1,
          limit: 20,
          total: 1,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        },
      }),
    );
    const handler = makeHandler({ findAllPaginated });

    const response = await handler(new Request('http://localhost/tasks'));

    expect(response.status).toBe(200);
    expect(findAllPaginated).toHaveBeenCalledWith({}, TASK_ACTOR_ID);
  });

  it('passes the session actor to task cancellation', async () => {
    const cancel = vi.fn(() => Effect.succeed(makeTaskResponse()));
    const handler = makeHandler({ cancel });

    const response = await handler(
      new Request(`http://localhost/tasks/${TASK_ID}/cancel`, {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith(TASK_ID, TASK_ACTOR_ID);
  });

  it('requires authentication', async () => {
    const handler = makeHandler({}, false);

    const response = await handler(new Request('http://localhost/tasks'));

    expect(response.status).toBe(401);
  });

  it('rejects invalid task ids at the route boundary', async () => {
    const findOne = vi.fn(() => Effect.succeed(makeTaskResponse()));
    const handler = makeHandler({ findOne });

    const response = await handler(
      new Request('http://localhost/tasks/not-a-uuid'),
    );

    expect(response.status).toBe(400);
    expect(findOne).not.toHaveBeenCalled();
  });
});
