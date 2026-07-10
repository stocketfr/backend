import { TaskStatus } from '@stocket/types/tasks';
import { Effect } from 'effect';
import { and, asc, eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { DrizzleDatabase } from '../../../platform/db/drizzle';
import { backgroundTasks } from '../../../platform/db/schema';
import { withDrizzleTransaction } from '../../../platform/db/transaction';
import { makeTryAsync } from '../../../platform/effect/try-async';
import { TasksInfrastructureError } from '../tasks.errors';
import type { TaskRow } from '../types';
import type {
  ClaimedTask,
  TaskLeaseState,
  TaskProgressPatch,
  TaskSettlementStatus,
} from './types';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new TasksInfrastructureError({
      action,
      cause,
      messageKey: 'tasks.repositoryFailed',
    }),
);

const afterMilliseconds = (milliseconds: number) =>
  sql`now() + (${milliseconds} * interval '1 millisecond')`;

export interface ClaimTaskOptions {
  readonly workerId: string;
  readonly leaseMs: number;
}

export interface TaskWorkerRepositoryShape {
  readonly claimNext: (
    options: ClaimTaskOptions,
  ) => Effect.Effect<ClaimedTask | null, TasksInfrastructureError>;
  readonly heartbeat: (
    task: ClaimedTask,
    leaseMs: number,
  ) => Effect.Effect<TaskLeaseState, TasksInfrastructureError>;
  readonly reportProgress: (
    task: ClaimedTask,
    patch: TaskProgressPatch,
  ) => Effect.Effect<boolean, TasksInfrastructureError>;
  readonly getLeaseState: (
    task: ClaimedTask,
  ) => Effect.Effect<TaskLeaseState, TasksInfrastructureError>;
  readonly complete: (
    task: ClaimedTask,
    result: unknown,
  ) => Effect.Effect<TaskSettlementStatus | null, TasksInfrastructureError>;
  readonly markCanceled: (
    task: ClaimedTask,
    reason: string,
  ) => Effect.Effect<boolean, TasksInfrastructureError>;
  readonly fail: (
    task: ClaimedTask,
    error: string,
    retryable: boolean,
    retryDelayMs: number,
  ) => Effect.Effect<TaskRow | null, TasksInfrastructureError>;
  readonly recoverExpired: (
    retryDelayMs: number,
  ) => Effect.Effect<number, TasksInfrastructureError>;
}

export class TaskWorkerRepository extends Effect.Service<TaskWorkerRepository>()(
  '@stocket/effect/tasks/worker/TaskWorkerRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;

      const activeLeaseWhere = (task: ClaimedTask) =>
        and(
          eq(backgroundTasks.id, task.row.id),
          eq(backgroundTasks.status, TaskStatus.RUNNING),
          eq(backgroundTasks.lease_owner, task.workerId),
          eq(backgroundTasks.lease_token, task.leaseToken),
          sql`${backgroundTasks.lease_expires_at} > now()`,
        );

      const claimNext = ({ workerId, leaseMs }: ClaimTaskOptions) =>
        tryAsync('claim background task', async () => {
          const leaseToken = uuidv4();

          return withDrizzleTransaction(db, async (tx) => {
            const [candidate] = await tx
              .select({ id: backgroundTasks.id })
              .from(backgroundTasks)
              .where(
                and(
                  eq(backgroundTasks.status, TaskStatus.QUEUED),
                  sql`${backgroundTasks.run_after} <= now()`,
                  sql`${backgroundTasks.attempt_count} < ${backgroundTasks.max_attempts}`,
                ),
              )
              .orderBy(
                asc(backgroundTasks.run_after),
                asc(backgroundTasks.created_at),
              )
              .limit(1)
              .for('update', { skipLocked: true });

            if (candidate === undefined) return null;

            const [row] = await tx
              .update(backgroundTasks)
              .set({
                status: TaskStatus.RUNNING,
                attempt_count: sql`${backgroundTasks.attempt_count} + 1`,
                lease_owner: workerId,
                lease_token: leaseToken,
                lease_expires_at: afterMilliseconds(leaseMs),
                started_at: sql`COALESCE(${backgroundTasks.started_at}, now())`,
                error: null,
                updated_at: sql`now()`,
              })
              .where(
                and(
                  eq(backgroundTasks.id, candidate.id),
                  eq(backgroundTasks.status, TaskStatus.QUEUED),
                ),
              )
              .returning();

            return row === undefined
              ? null
              : ({ row, workerId, leaseToken } satisfies ClaimedTask);
          });
        });

      const heartbeat = (task: ClaimedTask, leaseMs: number) =>
        tryAsync('heartbeat background task', async () => {
          const rows = await db
            .update(backgroundTasks)
            .set({
              lease_expires_at: afterMilliseconds(leaseMs),
              updated_at: sql`now()`,
            })
            .where(activeLeaseWhere(task))
            .returning({
              cancelRequestedAt: backgroundTasks.cancel_requested_at,
            });
          const row = rows[0];
          return {
            active: row !== undefined,
            cancelRequested:
              row !== undefined && row.cancelRequestedAt !== null,
          };
        });

      const reportProgress = (task: ClaimedTask, patch: TaskProgressPatch) =>
        tryAsync('report background task progress', async () => {
          const rows = await db
            .update(backgroundTasks)
            .set({
              ...(patch.total !== undefined
                ? { progress_total: patch.total }
                : {}),
              ...(patch.processed !== undefined
                ? { progress_processed: patch.processed }
                : {}),
              ...(patch.failed !== undefined
                ? { progress_failed: patch.failed }
                : {}),
              ...(patch.messageKey !== undefined
                ? { progress_message_key: patch.messageKey }
                : {}),
              ...(patch.messageArgs !== undefined
                ? { progress_message_args: patch.messageArgs }
                : {}),
              updated_at: sql`now()`,
            })
            .where(activeLeaseWhere(task))
            .returning({ id: backgroundTasks.id });
          return rows.length === 1;
        });

      const getLeaseState = (task: ClaimedTask) =>
        tryAsync('check background task lease', async () => {
          const [row] = await db
            .select({
              cancelRequestedAt: backgroundTasks.cancel_requested_at,
            })
            .from(backgroundTasks)
            .where(activeLeaseWhere(task))
            .limit(1);
          return {
            active: row !== undefined,
            cancelRequested:
              row !== undefined && row.cancelRequestedAt !== null,
          };
        });

      const complete = (task: ClaimedTask, result: unknown) =>
        tryAsync('complete background task', async () => {
          const [row] = await db
            .update(backgroundTasks)
            .set({
              status: sql`CASE
                WHEN ${backgroundTasks.cancel_requested_at} IS NULL
                  THEN ${TaskStatus.SUCCEEDED}
                ELSE ${TaskStatus.CANCELED}
              END`,
              result: sql`CASE
                WHEN ${backgroundTasks.cancel_requested_at} IS NULL
                  THEN ${JSON.stringify(result ?? null)}::jsonb
                ELSE NULL
              END`,
              error: sql`CASE
                WHEN ${backgroundTasks.cancel_requested_at} IS NULL
                  THEN NULL
                ELSE 'Task canceled during execution'
              END`,
              payload: null,
              lease_owner: null,
              lease_token: null,
              lease_expires_at: null,
              completed_at: sql`now()`,
              updated_at: sql`now()`,
            })
            .where(activeLeaseWhere(task))
            .returning({ status: backgroundTasks.status });

          if (row?.status === TaskStatus.SUCCEEDED) return 'succeeded';
          if (row?.status === TaskStatus.CANCELED) return 'canceled';
          return null;
        });

      const markCanceled = (task: ClaimedTask, reason: string) =>
        tryAsync('cancel running background task', async () => {
          const rows = await db
            .update(backgroundTasks)
            .set({
              status: TaskStatus.CANCELED,
              error: reason,
              payload: null,
              lease_owner: null,
              lease_token: null,
              lease_expires_at: null,
              completed_at: sql`now()`,
              updated_at: sql`now()`,
            })
            .where(activeLeaseWhere(task))
            .returning({ id: backgroundTasks.id });
          return rows.length === 1;
        });

      const fail = (
        task: ClaimedTask,
        error: string,
        retryable: boolean,
        retryDelayMs: number,
      ) =>
        tryAsync('fail background task', async () => {
          const shouldRetry = sql<boolean>`${retryable}
            AND ${backgroundTasks.attempt_count} < ${backgroundTasks.max_attempts}
            AND ${backgroundTasks.cancel_requested_at} IS NULL`;
          const [row] = await db
            .update(backgroundTasks)
            .set({
              status: sql`CASE
                WHEN ${backgroundTasks.cancel_requested_at} IS NOT NULL
                  THEN ${TaskStatus.CANCELED}
                WHEN ${shouldRetry}
                  THEN ${TaskStatus.QUEUED}
                ELSE ${TaskStatus.FAILED}
              END`,
              error: sql`CASE
                WHEN ${backgroundTasks.cancel_requested_at} IS NOT NULL
                  THEN 'Task canceled during execution'
                ELSE ${error}
              END`,
              payload: sql`CASE WHEN ${shouldRetry}
                THEN ${backgroundTasks.payload}
                ELSE NULL
              END`,
              run_after: sql`CASE WHEN ${shouldRetry}
                THEN ${afterMilliseconds(retryDelayMs)}
                ELSE ${backgroundTasks.run_after}
              END`,
              lease_owner: null,
              lease_token: null,
              lease_expires_at: null,
              completed_at: sql`CASE WHEN ${shouldRetry}
                THEN NULL
                ELSE now()
              END`,
              updated_at: sql`now()`,
            })
            .where(activeLeaseWhere(task))
            .returning();
          return row ?? null;
        });

      const recoverExpired = (retryDelayMs: number) =>
        tryAsync('recover expired background tasks', async () => {
          const canRetry = sql<boolean>`${backgroundTasks.attempt_count} < ${backgroundTasks.max_attempts}
            AND ${backgroundTasks.cancel_requested_at} IS NULL`;
          const rows = await db
            .update(backgroundTasks)
            .set({
              status: sql`CASE
                WHEN ${backgroundTasks.cancel_requested_at} IS NOT NULL
                  THEN ${TaskStatus.CANCELED}
                WHEN ${canRetry}
                  THEN ${TaskStatus.QUEUED}
                ELSE ${TaskStatus.FAILED}
              END`,
              error: sql`CASE
                WHEN ${backgroundTasks.cancel_requested_at} IS NOT NULL
                  THEN 'Task canceled after worker lease expired'
                ELSE 'Background task lease expired'
              END`,
              payload: sql`CASE WHEN ${canRetry}
                THEN ${backgroundTasks.payload}
                ELSE NULL
              END`,
              run_after: sql`CASE WHEN ${canRetry}
                THEN ${afterMilliseconds(retryDelayMs)}
                ELSE ${backgroundTasks.run_after}
              END`,
              lease_owner: null,
              lease_token: null,
              lease_expires_at: null,
              completed_at: sql`CASE WHEN ${canRetry}
                THEN NULL
                ELSE now()
              END`,
              updated_at: sql`now()`,
            })
            .where(
              and(
                eq(backgroundTasks.status, TaskStatus.RUNNING),
                sql`${backgroundTasks.lease_expires_at} <= now()`,
              ),
            )
            .returning({ id: backgroundTasks.id });
          return rows.length;
        });

      return {
        claimNext,
        heartbeat,
        reportProgress,
        getLeaseState,
        complete,
        markCanceled,
        fail,
        recoverExpired,
      } satisfies TaskWorkerRepositoryShape;
    }),
  },
) {}
