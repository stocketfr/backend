import { Config, Effect } from 'effect';
import type { TaskWorkerConfigShape } from '../../modules/tasks/worker/types';

const positiveInteger = (name: string, fallback: number) =>
  Config.integer(name).pipe(
    Config.withDefault(fallback),
    Config.validate({
      message: `${name} must be a positive integer`,
      validation: (value) => value > 0,
    }),
  );

const taskWorkerConfig = Config.all({
  concurrency: positiveInteger('BACKGROUND_TASK_CONCURRENCY', 4).pipe(
    Config.validate({
      message: 'BACKGROUND_TASK_CONCURRENCY must not exceed 32',
      validation: (value) => value <= 32,
    }),
  ),
  leaseMs: positiveInteger('BACKGROUND_TASK_LEASE_MS', 60_000),
  heartbeatMs: positiveInteger('BACKGROUND_TASK_HEARTBEAT_MS', 15_000),
  pollMs: positiveInteger('BACKGROUND_TASK_POLL_MS', 1_000),
  recoveryMs: positiveInteger('BACKGROUND_TASK_RECOVERY_MS', 30_000),
  retryDelayMs: positiveInteger('BACKGROUND_TASK_RETRY_DELAY_MS', 30_000),
  progressThrottleMs: positiveInteger(
    'BACKGROUND_TASK_PROGRESS_THROTTLE_MS',
    500,
  ),
}).pipe(
  Config.validate({
    message:
      'BACKGROUND_TASK_HEARTBEAT_MS must be less than BACKGROUND_TASK_LEASE_MS',
    validation: (config) => config.heartbeatMs < config.leaseMs,
  }),
);

export class TaskWorkerConfig
  extends Effect.Service<TaskWorkerConfig>()(
    '@stocket/effect/platform/TaskWorkerConfig',
    {
      effect: taskWorkerConfig.pipe(Effect.orDie),
    },
  )
  implements TaskWorkerConfigShape {}
