import { TaskStatus } from '@stocket/types/tasks';
import { Cause, Clock, Effect, Option, Ref } from 'effect';
import { hostname } from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../../../platform/http/request-context';
import {
  createLogger,
  DEFAULT_LOCALE,
} from '../../../platform/observability/messages';
import { makeServiceTracer } from '../../../platform/observability/service-tracer';
import { TaskWorkerConfig } from '../../../platform/config/task-worker-config';
import type { TasksInfrastructureError } from '../tasks.errors';
import type { TaskRow } from '../types';
import type {
  ClaimedTask,
  TaskExecutionContext,
  TaskHandler,
  TaskProgressPatch,
  TaskTerminalStatus,
  TaskWorkerConfigShape,
} from './types';
import { TaskRegistry, emptyTaskRegistryLayer } from './registry';
import {
  TaskWorkerRepository,
  type TaskWorkerRepositoryShape,
} from './repository';
import type {
  TaskExecutionFailed,
  TaskHandlerNotFound,
  TaskPayloadInvalid,
} from './worker.errors';
import { TaskExecutionCanceled, TaskLeaseLost } from './worker.errors';
import type { TaskRegistryShape } from './registry';

const logger = createLogger('tasks');
const DEFAULT_DRAIN_LIMIT = 100;

type WorkerFailure =
  | TaskExecutionCanceled
  | TaskExecutionFailed
  | TaskHandlerNotFound
  | TaskLeaseLost
  | TaskPayloadInvalid
  | TasksInfrastructureError;

export interface TaskWorkerDependencies {
  readonly repository: TaskWorkerRepositoryShape;
  readonly registry: TaskRegistryShape;
  readonly config: TaskWorkerConfigShape;
  readonly workerId: string;
}

const makeTaskRequestContext = (task: ClaimedTask): RequestContext => ({
  requestId: uuidv4(),
  path: `/background/tasks/${task.row.id}`,
  method: 'POST',
  ip: null,
  locale: DEFAULT_LOCALE,
  tenantId: task.row.tenant_id,
});

const describeCauseForLogs = (cause: Cause.Cause<unknown>) =>
  Cause.pretty(cause, { renderErrorCause: true });

export const makeTaskWorker = ({
  repository,
  registry,
  config,
  workerId,
}: TaskWorkerDependencies) => {
  const trace = makeServiceTracer({
    serviceName: 'TaskWorkerService',
    module: 'tasks',
    layer: 'service',
  });

  const heartbeat = (task: ClaimedTask) =>
    Effect.sleep(`${config.heartbeatMs} millis`).pipe(
      Effect.andThen(repository.heartbeat(task, config.leaseMs)),
      Effect.flatMap(
        (state): Effect.Effect<void, TaskExecutionCanceled | TaskLeaseLost> => {
          if (!state.active) {
            return Effect.fail(new TaskLeaseLost({ taskId: task.row.id }));
          }
          if (state.cancelRequested) {
            return Effect.fail(
              new TaskExecutionCanceled({
                reason: 'Task cancellation requested',
              }),
            );
          }
          return Effect.void;
        },
      ),
      Effect.forever,
    );

  const makeExecutionContext = (task: ClaimedTask) =>
    Effect.gen(function* () {
      const lastProgressAt = yield* Ref.make(0);

      return {
        task: task.row,
        reportProgress: (patch: TaskProgressPatch) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const previous = yield* Ref.get(lastProgressAt);
            if (
              patch.force !== true &&
              now - previous < config.progressThrottleMs
            ) {
              return;
            }

            const active = yield* repository.reportProgress(task, patch);
            if (!active) {
              return yield* new TaskLeaseLost({ taskId: task.row.id });
            }
            yield* Ref.set(lastProgressAt, now);
          }),
        isCancellationRequested: repository
          .getLeaseState(task)
          .pipe(
            Effect.flatMap((state) =>
              state.active
                ? Effect.succeed(state.cancelRequested)
                : Effect.fail(new TaskLeaseLost({ taskId: task.row.id })),
            ),
          ),
      } satisfies TaskExecutionContext;
    });

  const logSettlement = (task: ClaimedTask, status: string) =>
    logger.info('settled', {
      taskId: task.row.id,
      taskType: task.row.type,
      workerId: task.workerId,
      status,
    });

  const logLeaseLost = (task: ClaimedTask) =>
    logger.warn('leaseLost', {
      taskId: task.row.id,
      taskType: task.row.type,
      workerId: task.workerId,
    });

  const runTerminalHook = (
    task: ClaimedTask,
    handler: TaskHandler,
    status: TaskTerminalStatus,
  ) =>
    handler.onSettled === undefined
      ? Effect.void
      : handler.onSettled(task.row, status);

  const logTerminalSettlement = (
    task: ClaimedTask,
    handler: TaskHandler,
    status: TaskTerminalStatus,
  ) =>
    runTerminalHook(task, handler, status).pipe(
      Effect.andThen(logSettlement(task, status)),
    );

  const settleReturnedRow = (
    task: ClaimedTask,
    handler: TaskHandler | undefined,
    row: TaskRow | null,
  ) => {
    if (row === null) return logLeaseLost(task);
    if (
      row.status === TaskStatus.SUCCEEDED ||
      row.status === TaskStatus.FAILED ||
      row.status === TaskStatus.CANCELED
    ) {
      return handler === undefined
        ? logSettlement(task, row.status)
        : logTerminalSettlement(task, handler, row.status);
    }
    return logSettlement(task, row.status);
  };

  const settleSuccess = (
    task: ClaimedTask,
    handler: TaskHandler,
    result: unknown,
  ) =>
    repository
      .complete(task, result)
      .pipe(
        Effect.flatMap((status) =>
          status === null
            ? logLeaseLost(task)
            : logTerminalSettlement(task, handler, status),
        ),
      );

  const settleFailure = (
    task: ClaimedTask,
    failure: WorkerFailure,
    handler?: TaskHandler,
  ) => {
    switch (failure._tag) {
      case 'TaskLeaseLost':
        return logLeaseLost(task);
      case 'TaskExecutionCanceled':
        return repository
          .markCanceled(task, failure.reason)
          .pipe(
            Effect.flatMap((settled) =>
              settled
                ? handler === undefined
                  ? logSettlement(task, TaskStatus.CANCELED)
                  : logTerminalSettlement(task, handler, TaskStatus.CANCELED)
                : logLeaseLost(task),
            ),
          );
      case 'TaskPayloadInvalid':
        return repository
          .fail(task, 'Invalid background task payload', false, 0)
          .pipe(Effect.flatMap((row) => settleReturnedRow(task, handler, row)));
      case 'TaskHandlerNotFound':
        return repository
          .fail(
            task,
            `No handler registered for task type: ${failure.taskType}`,
            false,
            0,
          )
          .pipe(Effect.flatMap((row) => settleReturnedRow(task, handler, row)));
      case 'TaskExecutionFailed':
        return repository
          .fail(task, failure.error, failure.retryable, config.retryDelayMs)
          .pipe(Effect.flatMap((row) => settleReturnedRow(task, handler, row)));
      case 'TasksInfrastructureError':
        return repository
          .fail(
            task,
            'Background task infrastructure operation failed',
            true,
            config.retryDelayMs,
          )
          .pipe(Effect.flatMap((row) => settleReturnedRow(task, handler, row)));
    }
  };

  const runClaimedTask = (task: ClaimedTask) =>
    Effect.gen(function* () {
      const executionContext = yield* makeExecutionContext(task);
      const handler = yield* registry
        .get(task.row.type)
        .pipe(
          Effect.catchTag('TaskHandlerNotFound', (failure) =>
            settleFailure(task, failure).pipe(Effect.as(null)),
          ),
        );
      if (handler === null) return;

      const execution = handler
        .run(task.row, executionContext)
        .pipe(Effect.raceFirst(heartbeat(task)));

      const exit = yield* Effect.exit(execution);
      if (exit._tag === 'Success') {
        yield* settleSuccess(task, handler, exit.value);
        return;
      }

      if (Cause.isInterruptedOnly(exit.cause)) {
        return yield* Effect.failCause(exit.cause);
      }

      const failure = Cause.failureOption(exit.cause);
      if (Option.isSome(failure)) {
        yield* settleFailure(task, failure.value, handler);
        return;
      }

      yield* logger.error('executionDefect', {
        taskId: task.row.id,
        taskType: task.row.type,
        workerId: task.workerId,
        error: describeCauseForLogs(exit.cause),
      });
      yield* repository
        .fail(
          task,
          'Background task execution failed unexpectedly',
          true,
          config.retryDelayMs,
        )
        .pipe(Effect.flatMap((row) => settleReturnedRow(task, handler, row)));
    }).pipe(
      Effect.provideService(
        CurrentRequestContext,
        makeTaskRequestContext(task),
      ),
      Effect.catchAllCause((cause) => {
        if (Cause.isInterruptedOnly(cause)) {
          return Effect.failCause(cause);
        }
        return logger.error('settlementFailed', {
          taskId: task.row.id,
          taskType: task.row.type,
          workerId: task.workerId,
          error: describeCauseForLogs(cause),
        });
      }),
    );

  const runOnceFor = (laneWorkerId: string) =>
    repository
      .claimNext({ workerId: laneWorkerId, leaseMs: config.leaseMs })
      .pipe(
        Effect.flatMap((claimed) =>
          claimed === null
            ? Effect.succeed(false)
            : runClaimedTask(claimed).pipe(Effect.as(true)),
        ),
        trace.span('runOnce'),
      );

  const runOnce = runOnceFor(workerId);

  const drain = (limit = DEFAULT_DRAIN_LIMIT) =>
    Effect.gen(function* () {
      let processed = 0;
      for (let index = 0; index < limit; index++) {
        const didRun = yield* runOnce;
        if (!didRun) break;
        processed += 1;
      }
      return processed;
    }).pipe(trace.span('drain'));

  const laneLoop = (laneWorkerId: string) =>
    runOnceFor(laneWorkerId).pipe(
      Effect.catchAllCause((cause) => {
        if (Cause.isInterruptedOnly(cause)) {
          return Effect.failCause(cause);
        }
        return logger
          .error('workerFailed', {
            workerId: laneWorkerId,
            error: describeCauseForLogs(cause),
          })
          .pipe(Effect.as(false));
      }),
      Effect.flatMap((didRun) =>
        didRun ? Effect.void : Effect.sleep(`${config.pollMs} millis`),
      ),
      Effect.forever,
    );

  const recoveryLoop = repository.recoverExpired(config.retryDelayMs).pipe(
    Effect.tap((taskCount) =>
      taskCount === 0
        ? Effect.void
        : logger.info('recovered', { taskCount, workerId }),
    ),
    Effect.catchAllCause((cause) => {
      if (Cause.isInterruptedOnly(cause)) {
        return Effect.failCause(cause);
      }
      return logger.error('recoveryFailed', {
        workerId,
        error: describeCauseForLogs(cause),
      });
    }),
    Effect.andThen(Effect.sleep(`${config.recoveryMs} millis`)),
    Effect.forever,
  );

  const runLoop = logger
    .info('workerStarted', { workerId })
    .pipe(
      Effect.andThen(
        Effect.all(
          [
            recoveryLoop,
            ...Array.from({ length: config.concurrency }, (_, index) =>
              laneLoop(`${workerId}-${index + 1}`),
            ),
          ],
          { concurrency: 'unbounded', discard: true },
        ),
      ),
    );

  return {
    workerId,
    runOnce,
    drain,
    runLoop,
  };
};

export class TaskWorkerService extends Effect.Service<TaskWorkerService>()(
  '@stocket/effect/tasks/worker/TaskWorkerService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* TaskWorkerRepository;
      const registry = yield* TaskRegistry;
      const config = yield* TaskWorkerConfig;
      const workerId = `${hostname()}-${process.pid}-${uuidv4()}`;
      return makeTaskWorker({ repository, registry, config, workerId });
    }),
    dependencies: [
      TaskWorkerRepository.Default,
      TaskWorkerConfig.Default,
      emptyTaskRegistryLayer,
    ],
  },
) {}
