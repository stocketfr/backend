import { randomUUID } from 'node:crypto';
import { Cause, Effect, Fiber } from 'effect';
import { DEFAULT_LOCALE } from '../../platform/observability/messages';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../../platform/http/request-context';
import {
  FeatureNotEnabled,
  FeatureTenantNotFound,
} from '../features/features.errors';
import { TasksRepository } from './repository';
import { TaskRegistry } from './registry';
import { TaskHandlerNotFound, TaskPayloadInvalid } from './tasks.errors';
import type {
  ClaimedTask,
  TaskHandlerOutcome,
  TaskProgressPatch,
  TaskTypeDto,
} from './types';
import { describeTaskError } from './utils';

const positiveMillisecondsFromEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number of milliseconds`);
  }
  return parsed;
};

const LEASE_MS = positiveMillisecondsFromEnv(
  'BACKGROUND_TASK_LEASE_MS',
  60_000,
);
const HEARTBEAT_MS = positiveMillisecondsFromEnv(
  'BACKGROUND_TASK_HEARTBEAT_MS',
  15_000,
);
const POLL_MS = positiveMillisecondsFromEnv('BACKGROUND_TASK_POLL_MS', 1_000);
const RETRY_DELAY_MS = positiveMillisecondsFromEnv(
  'BACKGROUND_TASK_RETRY_DELAY_MS',
  30_000,
);
const DEFAULT_DRAIN_LIMIT = 100;

const makeTaskRequestContext = (task: ClaimedTask['row']): RequestContext => ({
  requestId: randomUUID(),
  path: `/background/tasks/${task.id}`,
  method: 'POST',
  ip: null,
  locale: DEFAULT_LOCALE,
  tenantId: task.tenant_id,
});

const permanentWorkerFailures = [
  FeatureNotEnabled,
  FeatureTenantNotFound,
  TaskHandlerNotFound,
  TaskPayloadInvalid,
];

const causeFailure = (cause: Cause.Cause<unknown>): unknown | null => {
  const failure = Cause.failureOption(cause);
  return failure._tag === 'Some' ? failure.value : null;
};

const isPermanentWorkerFailure = (error: unknown) =>
  permanentWorkerFailures.some((Failure) => error instanceof Failure);

const describeWorkerCause = (cause: Cause.Cause<unknown>) =>
  causeFailure(cause) === null
    ? Cause.pretty(cause)
    : describeTaskError(causeFailure(cause));

export class TaskWorkerService extends Effect.Service<TaskWorkerService>()(
  '@stocket/effect/tasks/TaskWorkerService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* TasksRepository;
      const registry = yield* TaskRegistry;
      const workerId = `api-${process.pid}-${randomUUID()}`;

      const heartbeatLoop = (task: ClaimedTask) =>
        Effect.sleep(`${HEARTBEAT_MS} millis`).pipe(
          Effect.zipRight(
            repository
              .heartbeat(task.row.id, task.workerId, LEASE_MS)
              .pipe(
                Effect.catchAllCause((cause) =>
                  Effect.logError({
                    messageKey: 'tasks.heartbeatFailed',
                    cause,
                  }).pipe(Effect.as(true)),
                ),
              ),
          ),
          Effect.flatMap((ok) => (ok ? Effect.void : Effect.interrupt)),
          Effect.forever,
        );

      const makeExecutionContext = (task: ClaimedTask) => ({
        task: task.row,
        workerId: task.workerId,
        reportProgress: (patch: TaskProgressPatch) =>
          repository.reportProgress(task.row.id, task.workerId, patch).pipe(
            Effect.catchAll((cause) =>
              Effect.logError({ messageKey: 'tasks.progressFailed', cause }),
            ),
            Effect.asVoid,
          ),
        isCancelRequested: repository
          .isCancelRequested(task.row.id, task.workerId)
          .pipe(
            Effect.catchAll((cause) =>
              Effect.logError({
                messageKey: 'tasks.cancelCheckFailed',
                cause,
              }).pipe(Effect.as(false)),
            ),
          ),
      });

      const settleOutcome = (
        task: ClaimedTask,
        outcome: TaskHandlerOutcome,
      ) => {
        switch (outcome._tag) {
          case 'succeeded':
            return repository.complete(
              task.row.id,
              task.workerId,
              outcome.result,
            );
          case 'canceled':
            return repository.markCanceled(
              task.row.id,
              task.workerId,
              outcome.error ?? 'Task canceled',
            );
          case 'failed':
            return repository.fail(
              task.row.id,
              task.workerId,
              outcome.error,
              outcome.retryable,
              RETRY_DELAY_MS,
            );
        }
      };

      const runClaimedTask = (claimed: ClaimedTask) =>
        Effect.gen(function* () {
          const heartbeat = yield* Effect.fork(heartbeatLoop(claimed));
          const handler = yield* registry.getHandler(claimed.row.type);
          yield* registry.authorizeExecution(claimed.row.type as TaskTypeDto);
          const outcome = yield* handler
            .run(claimed.row, makeExecutionContext(claimed))
            .pipe(
              Effect.ensuring(Fiber.interrupt(heartbeat).pipe(Effect.ignore)),
            );
          const settled = yield* settleOutcome(claimed, outcome);
          if (!settled) {
            yield* Effect.logWarning({ messageKey: 'tasks.leaseLost' });
          }
        }).pipe(
          Effect.provideService(
            CurrentRequestContext,
            makeTaskRequestContext(claimed.row),
          ),
          Effect.catchAllCause((cause) => {
            if (Cause.isInterruptedOnly(cause)) {
              return Effect.failCause(cause);
            }

            const failure = causeFailure(cause);
            return repository
              .fail(
                claimed.row.id,
                claimed.workerId,
                describeWorkerCause(cause),
                failure === null ? true : !isPermanentWorkerFailure(failure),
                RETRY_DELAY_MS,
              )
              .pipe(
                Effect.catchAllCause((fallbackCause) =>
                  Effect.logError({
                    messageKey: 'tasks.workerFailed',
                    cause: fallbackCause,
                  }),
                ),
                Effect.asVoid,
              );
          }),
        );

      const runOnce = Effect.gen(function* () {
        yield* repository
          .recoverExpired(RETRY_DELAY_MS)
          .pipe(
            Effect.catchAll((cause) =>
              Effect.logError({ messageKey: 'tasks.recoveryFailed', cause }),
            ),
          );
        const row = yield* repository.claimNext({
          workerId,
          leaseMs: LEASE_MS,
        });
        if (!row) return false;
        yield* runClaimedTask({ row, workerId });
        return true;
      }).pipe(Effect.withSpan('TaskWorkerService.runOnce'));

      const drain = (limit = DEFAULT_DRAIN_LIMIT) =>
        Effect.gen(function* () {
          let processed = 0;
          for (let i = 0; i < limit; i++) {
            const didRun = yield* runOnce;
            if (!didRun) break;
            processed++;
          }
          return processed;
        }).pipe(Effect.withSpan('TaskWorkerService.drain'));

      const runLoop = runOnce.pipe(
        Effect.catchAllCause((cause) => {
          if (Cause.isInterruptedOnly(cause)) {
            return Effect.failCause(cause);
          }

          return Effect.logError({
            messageKey: 'tasks.workerFailed',
            cause,
          }).pipe(Effect.as(false));
        }),
        Effect.flatMap((didRun) =>
          didRun ? Effect.void : Effect.sleep(`${POLL_MS} millis`),
        ),
        Effect.forever,
      );

      return {
        workerId,
        runOnce,
        drain,
        runLoop,
      };
    }),
    dependencies: [TasksRepository.Default, TaskRegistry.Default],
  },
) {}
