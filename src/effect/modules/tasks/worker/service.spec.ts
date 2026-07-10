import { TaskStatus } from '@stocket/types/tasks';
import { Effect } from 'effect';
import { makeTaskRow } from '../__fixtures__/task';
import type { TaskRow } from '../types';
import { makeTaskRegistry } from './registry';
import type { TaskWorkerRepositoryShape } from './repository';
import { makeTaskWorker } from './service';
import type { ClaimedTask, TaskHandler, TaskWorkerConfigShape } from './types';
import { TaskExecutionFailed, TaskPayloadInvalid } from './worker.errors';

const config: TaskWorkerConfigShape = {
  concurrency: 2,
  leaseMs: 1_000,
  heartbeatMs: 1,
  pollMs: 1,
  recoveryMs: 1_000,
  retryDelayMs: 500,
  progressThrottleMs: 1,
};

interface RepositoryState {
  claimed: boolean;
  heartbeatActive: boolean;
  heartbeatCancelRequested: boolean;
  completed: number;
  canceled: number;
  failed: Array<{ readonly error: string; readonly retryable: boolean }>;
  progress: number;
  events: string[];
}

const makeRepository = () => {
  const state: RepositoryState = {
    claimed: false,
    heartbeatActive: true,
    heartbeatCancelRequested: false,
    completed: 0,
    canceled: 0,
    failed: [],
    progress: 0,
    events: [],
  };
  const runningRow = makeTaskRow({
    status: TaskStatus.RUNNING,
    attempt_count: 1,
    lease_owner: 'worker-test',
    lease_token: '30000000-0000-4000-8000-000000000001',
    lease_expires_at: new Date('2099-01-01T00:00:00.000Z'),
    started_at: new Date('2026-07-10T10:00:00.000Z'),
  });
  const claimedTask: ClaimedTask = {
    row: runningRow,
    workerId: 'worker-test',
    leaseToken: '30000000-0000-4000-8000-000000000001',
  };

  const repository: TaskWorkerRepositoryShape = {
    claimNext: () => {
      if (state.claimed) return Effect.succeed(null);
      state.claimed = true;
      return Effect.succeed(claimedTask);
    },
    heartbeat: () =>
      Effect.succeed({
        active: state.heartbeatActive,
        cancelRequested: state.heartbeatCancelRequested,
      }),
    reportProgress: () =>
      Effect.sync(() => {
        state.progress += 1;
        return true;
      }),
    getLeaseState: () =>
      Effect.succeed({ active: true, cancelRequested: false }),
    complete: () =>
      Effect.sync(() => {
        state.completed += 1;
        state.events.push('settlement:succeeded');
        return 'succeeded' as const;
      }),
    markCanceled: () =>
      Effect.sync(() => {
        state.canceled += 1;
        state.events.push('settlement:canceled');
        return true;
      }),
    fail: (_task, error, retryable) =>
      Effect.sync(() => {
        state.failed.push({ error, retryable });
        state.events.push(
          `settlement:${retryable ? TaskStatus.QUEUED : TaskStatus.FAILED}`,
        );
        return makeTaskRow({
          status: retryable ? TaskStatus.QUEUED : TaskStatus.FAILED,
        });
      }),
    recoverExpired: () => Effect.succeed(0),
  };

  return { repository, state };
};

const runWithHandler = (
  handler: TaskHandler,
  repository: TaskWorkerRepositoryShape,
) => {
  const worker = makeTaskWorker({
    repository,
    registry: makeTaskRegistry([handler]),
    config,
    workerId: 'worker-test',
  });
  return Effect.runPromise(worker.runOnce);
};

describe('TaskWorkerService', () => {
  it('runs a handler, records progress, and settles success', async () => {
    const { repository, state } = makeRepository();
    const handler: TaskHandler = {
      type: 'test-task',
      run: (_task, context) =>
        context
          .reportProgress({ processed: 1, force: true })
          .pipe(Effect.as({ imported: 1 })),
      onSettled: (_task, status) =>
        Effect.sync(() => {
          state.events.push(`hook:${status}`);
        }),
    };

    await expect(runWithHandler(handler, repository)).resolves.toBe(true);
    expect(state.progress).toBe(1);
    expect(state.completed).toBe(1);
    expect(state.failed).toEqual([]);
    expect(state.events).toEqual(['settlement:succeeded', 'hook:succeeded']);
  });

  it('does not retry an invalid payload', async () => {
    const { repository, state } = makeRepository();
    const handler: TaskHandler = {
      type: 'test-task',
      run: () =>
        Effect.fail(new TaskPayloadInvalid({ details: 'missing blob key' })),
      onSettled: (_task, status) =>
        Effect.sync(() => {
          state.events.push(`hook:${status}`);
        }),
    };

    await expect(runWithHandler(handler, repository)).resolves.toBe(true);
    expect(state.completed).toBe(0);
    expect(state.failed).toEqual([
      { error: 'Invalid background task payload', retryable: false },
    ]);
    expect(state.events).toEqual(['settlement:failed', 'hook:failed']);
  });

  it('requeues explicitly retryable handler failures', async () => {
    const { repository, state } = makeRepository();
    const handler: TaskHandler = {
      type: 'test-task',
      run: () =>
        Effect.fail(
          new TaskExecutionFailed({
            error: 'dependency unavailable',
            retryable: true,
          }),
        ),
      onSettled: (_task, status) =>
        Effect.sync(() => {
          state.events.push(`hook:${status}`);
        }),
    };

    await expect(runWithHandler(handler, repository)).resolves.toBe(true);
    expect(state.failed).toEqual([
      { error: 'dependency unavailable', retryable: true },
    ]);
    expect(state.events).toEqual(['settlement:queued']);
  });

  it('interrupts the handler when the heartbeat loses its lease', async () => {
    const { repository, state } = makeRepository();
    state.heartbeatActive = false;
    let interrupted = false;
    const handler: TaskHandler = {
      type: 'test-task',
      run: () =>
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
      onSettled: (_task, status) =>
        Effect.sync(() => {
          state.events.push(`hook:${status}`);
        }),
    };

    await expect(runWithHandler(handler, repository)).resolves.toBe(true);
    expect(interrupted).toBe(true);
    expect(state.completed).toBe(0);
    expect(state.failed).toEqual([]);
    expect(state.events).toEqual([]);
  });

  it('interrupts and cancels the handler after a cancellation request', async () => {
    const { repository, state } = makeRepository();
    state.heartbeatCancelRequested = true;
    let interrupted = false;
    const handler: TaskHandler = {
      type: 'test-task',
      run: () =>
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
      onSettled: (_task, status) =>
        Effect.sync(() => {
          state.events.push(`hook:${status}`);
        }),
    };

    await expect(runWithHandler(handler, repository)).resolves.toBe(true);
    expect(interrupted).toBe(true);
    expect(state.canceled).toBe(1);
    expect(state.completed).toBe(0);
    expect(state.events).toEqual(['settlement:canceled', 'hook:canceled']);
  });

  it('returns false when no task is available', async () => {
    const { repository, state } = makeRepository();
    state.claimed = true;
    const handler: TaskHandler = {
      type: 'test-task',
      run: (_task: TaskRow) => Effect.succeed(null),
    };

    await expect(runWithHandler(handler, repository)).resolves.toBe(false);
    expect(state.completed).toBe(0);
  });
});
