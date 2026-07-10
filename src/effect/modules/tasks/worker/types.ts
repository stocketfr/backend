import type { TaskProgressMessageArgs } from '@stocket/types/tasks';
import type { Effect } from 'effect';
import type { AnyMessageKey } from '../../../platform/observability/messages';
import type { TasksInfrastructureError } from '../tasks.errors';
import type { TaskRow } from '../types';
import type { TaskHandlerError, TaskLeaseLost } from './worker.errors';

export interface ClaimedTask {
  readonly row: TaskRow;
  readonly workerId: string;
  readonly leaseToken: string;
}

export interface TaskProgressPatch {
  readonly total?: number | null;
  readonly processed?: number;
  readonly failed?: number;
  readonly messageKey?: AnyMessageKey | null;
  readonly messageArgs?: TaskProgressMessageArgs | null;
  readonly force?: boolean;
}

export interface TaskExecutionContext {
  readonly task: TaskRow;
  readonly reportProgress: (
    patch: TaskProgressPatch,
  ) => Effect.Effect<void, TasksInfrastructureError | TaskLeaseLost>;
  readonly isCancellationRequested: Effect.Effect<
    boolean,
    TasksInfrastructureError | TaskLeaseLost
  >;
}

export interface TaskHandler {
  readonly type: string;
  readonly run: (
    task: TaskRow,
    context: TaskExecutionContext,
  ) => Effect.Effect<
    unknown,
    TaskHandlerError | TasksInfrastructureError | TaskLeaseLost
  >;
}

export interface TaskLeaseState {
  readonly active: boolean;
  readonly cancelRequested: boolean;
}

export type TaskSettlementStatus = 'succeeded' | 'canceled';

export interface TaskWorkerConfigShape {
  readonly concurrency: number;
  readonly leaseMs: number;
  readonly heartbeatMs: number;
  readonly pollMs: number;
  readonly recoveryMs: number;
  readonly retryDelayMs: number;
  readonly progressThrottleMs: number;
}
