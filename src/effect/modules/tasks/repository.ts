import { Effect } from 'effect';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
  type RepositoryPaginatedResult,
} from '@stocket/types/common';
import { SortOrder } from '@stocket/types/common';
import { makeTryAsync } from '../../platform/effect/try-async';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { backgroundTasks } from '../../platform/db/schema';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { TasksInfrastructureError } from './tasks.errors';
import type {
  ClaimTaskOptions,
  EnqueueTaskParams,
  TaskProgressPatch,
  TaskQueryDto,
  TaskRow,
} from './types';
import { rowsOf } from './utils';

const tryAsync = makeTryAsync(
  (action, cause) =>
    new TasksInfrastructureError({
      action,
      cause,
      messageKey: 'tasks.repositoryFailed',
    }),
);

const publicTaskSelection = {
  id: backgroundTasks.id,
  tenant_id: backgroundTasks.tenant_id,
  type: backgroundTasks.type,
  status: backgroundTasks.status,
  result: backgroundTasks.result,
  error: backgroundTasks.error,
  created_by: backgroundTasks.created_by,
  attempt_count: backgroundTasks.attempt_count,
  max_attempts: backgroundTasks.max_attempts,
  run_after: backgroundTasks.run_after,
  lease_owner: backgroundTasks.lease_owner,
  lease_expires_at: backgroundTasks.lease_expires_at,
  progress_total: backgroundTasks.progress_total,
  progress_processed: backgroundTasks.progress_processed,
  progress_failed: backgroundTasks.progress_failed,
  progress_message: backgroundTasks.progress_message,
  cancel_requested_at: backgroundTasks.cancel_requested_at,
  started_at: backgroundTasks.started_at,
  completed_at: backgroundTasks.completed_at,
  created_at: backgroundTasks.created_at,
  updated_at: backgroundTasks.updated_at,
};

const publicTaskReturningSql = sql`
  id,
  tenant_id,
  type,
  status,
  result,
  error,
  created_by,
  attempt_count,
  max_attempts,
  run_after,
  lease_owner,
  lease_expires_at,
  progress_total,
  progress_processed,
  progress_failed,
  progress_message,
  cancel_requested_at,
  started_at,
  completed_at,
  created_at,
  updated_at
`;

const leaseInterval = (leaseMs: number) =>
  sql`${Math.ceil(leaseMs / 1000)} * interval '1 second'`;

const retryInterval = (retryDelayMs: number) =>
  sql`${Math.ceil(retryDelayMs / 1000)} * interval '1 second'`;

export class TasksRepository extends Effect.Service<TasksRepository>()(
  '@stocket/effect/tasks/TasksRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;

      const enqueue = (
        params: EnqueueTaskParams,
      ): Effect.Effect<TaskRow, TasksInfrastructureError | TenantNotResolved> =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('enqueue background task', async () => {
            const rows = await db
              .insert(backgroundTasks)
              .values({
                tenant_id: tenantId,
                type: params.type,
                status: 'queued',
                payload: params.payload,
                created_by: params.createdBy,
                max_attempts: params.maxAttempts ?? 3,
                run_after: params.runAfter ?? new Date(),
                progress_total: params.progressTotal ?? null,
                progress_message: params.progressMessage ?? null,
              })
              .returning();
            return rows[0] as TaskRow;
          });
        });

      const buildListConditions = (tenantId: string, query: TaskQueryDto) => {
        const conditions: SQL[] = [eq(backgroundTasks.tenant_id, tenantId)];
        if (query.type) {
          conditions.push(eq(backgroundTasks.type, query.type));
        }
        if (query.status) {
          conditions.push(eq(backgroundTasks.status, query.status));
        }
        return and(...conditions)!;
      };

      const findAllPaginated = (
        query: TaskQueryDto,
      ): Effect.Effect<
        RepositoryPaginatedResult<TaskRow>,
        TasksInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          const { page, limit, skip } = resolvePaginationWindow(
            query.page,
            query.limit,
          );
          const where = buildListConditions(tenantId, query);
          return yield* tryAsync('list background tasks', async () => {
            const [totalRow] = await db
              .select({ total: count() })
              .from(backgroundTasks)
              .where(where);
            const data = await db
              .select(publicTaskSelection)
              .from(backgroundTasks)
              .where(where)
              .orderBy(
                query.sort_order === SortOrder.ASC
                  ? asc(backgroundTasks.created_at)
                  : desc(backgroundTasks.created_at),
                desc(backgroundTasks.id),
              )
              .limit(limit)
              .offset(skip);
            return toRepositoryPaginatedResult(
              data as TaskRow[],
              totalRow?.total ?? 0,
              page,
              limit,
            );
          });
        });

      const findById = (
        id: string,
      ): Effect.Effect<
        TaskRow | null,
        TasksInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('load background task', async () => {
            const rows = await db
              .select(publicTaskSelection)
              .from(backgroundTasks)
              .where(
                and(
                  eq(backgroundTasks.tenant_id, tenantId),
                  eq(backgroundTasks.id, id),
                ),
              )
              .limit(1);
            return (rows[0] as TaskRow | undefined) ?? null;
          });
        });

      const cancel = (
        id: string,
      ): Effect.Effect<
        TaskRow | null,
        TasksInfrastructureError | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('cancel background task', async () => {
            const result = await db.execute(sql`
              UPDATE background_tasks
              SET
                status = CASE
                  WHEN status = 'queued' THEN 'canceled'
                  ELSE status
                END,
                cancel_requested_at = COALESCE(cancel_requested_at, now()),
                completed_at = CASE
                  WHEN status = 'queued' THEN now()
                  ELSE completed_at
                END,
                payload = CASE
                  WHEN status = 'queued' THEN NULL
                  ELSE payload
                END,
                error = CASE
                  WHEN status = 'queued' THEN 'Task canceled before execution'
                  ELSE error
                END,
                updated_at = now()
              WHERE tenant_id = ${tenantId}
                AND id = ${id}
              RETURNING ${publicTaskReturningSql}
            `);
            return rowsOf<TaskRow>(result)[0] ?? null;
          });
        });

      const claimNext = (
        options: ClaimTaskOptions,
      ): Effect.Effect<TaskRow | null, TasksInfrastructureError> =>
        tryAsync('claim background task', async () => {
          const result = await db.execute(sql`
            WITH next_task AS (
              SELECT id
              FROM background_tasks
              WHERE status = 'queued'
                AND run_after <= now()
                AND attempt_count < max_attempts
              ORDER BY run_after ASC, created_at ASC
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            UPDATE background_tasks task
            SET
              status = 'running',
              lease_owner = ${options.workerId},
              lease_expires_at = now() + (${leaseInterval(options.leaseMs)}),
              attempt_count = task.attempt_count + 1,
              started_at = COALESCE(task.started_at, now()),
              error = NULL,
              updated_at = now()
            FROM next_task
            WHERE task.id = next_task.id
            RETURNING task.*
          `);
          return rowsOf<TaskRow>(result)[0] ?? null;
        });

      const heartbeat = (
        id: string,
        workerId: string,
        leaseMs: number,
      ): Effect.Effect<boolean, TasksInfrastructureError> =>
        tryAsync('heartbeat background task', async () => {
          const rows = await db
            .update(backgroundTasks)
            .set({
              lease_expires_at: sql`now() + (${leaseInterval(leaseMs)})`,
              updated_at: new Date(),
            })
            .where(
              and(
                eq(backgroundTasks.id, id),
                eq(backgroundTasks.lease_owner, workerId),
                eq(backgroundTasks.status, 'running'),
              ),
            )
            .returning({ id: backgroundTasks.id });
          return rows.length > 0;
        });

      const reportProgress = (
        id: string,
        workerId: string,
        patch: TaskProgressPatch,
      ): Effect.Effect<boolean, TasksInfrastructureError> =>
        tryAsync('update task progress', async () => {
          const rows = await db
            .update(backgroundTasks)
            .set({
              ...(patch.total === undefined
                ? {}
                : { progress_total: patch.total }),
              ...(patch.processed === undefined
                ? {}
                : { progress_processed: patch.processed }),
              ...(patch.failed === undefined
                ? {}
                : { progress_failed: patch.failed }),
              ...(patch.message === undefined
                ? {}
                : { progress_message: patch.message }),
              updated_at: new Date(),
            })
            .where(
              and(
                eq(backgroundTasks.id, id),
                eq(backgroundTasks.lease_owner, workerId),
                eq(backgroundTasks.status, 'running'),
              ),
            )
            .returning({ id: backgroundTasks.id });
          return rows.length > 0;
        });

      const isCancelRequested = (
        id: string,
        workerId: string,
      ): Effect.Effect<boolean, TasksInfrastructureError> =>
        tryAsync('check task cancellation', async () => {
          const rows = await db
            .select({
              cancel_requested_at: backgroundTasks.cancel_requested_at,
            })
            .from(backgroundTasks)
            .where(
              and(
                eq(backgroundTasks.id, id),
                eq(backgroundTasks.lease_owner, workerId),
                eq(backgroundTasks.status, 'running'),
              ),
            )
            .limit(1);
          return rows[0]?.cancel_requested_at !== null;
        });

      const complete = (
        id: string,
        workerId: string,
        result: unknown | null,
      ): Effect.Effect<boolean, TasksInfrastructureError> =>
        tryAsync('complete background task', async () => {
          const rows = await db
            .update(backgroundTasks)
            .set({
              status: 'succeeded',
              result,
              error: null,
              payload: null,
              lease_owner: null,
              lease_expires_at: null,
              completed_at: new Date(),
              updated_at: new Date(),
            })
            .where(
              and(
                eq(backgroundTasks.id, id),
                eq(backgroundTasks.lease_owner, workerId),
                eq(backgroundTasks.status, 'running'),
              ),
            )
            .returning({ id: backgroundTasks.id });
          return rows.length > 0;
        });

      const markCanceled = (
        id: string,
        workerId: string,
        error: string,
      ): Effect.Effect<boolean, TasksInfrastructureError> =>
        tryAsync('mark background task canceled', async () => {
          const rows = await db
            .update(backgroundTasks)
            .set({
              status: 'canceled',
              result: null,
              error,
              payload: null,
              lease_owner: null,
              lease_expires_at: null,
              completed_at: new Date(),
              updated_at: new Date(),
            })
            .where(
              and(
                eq(backgroundTasks.id, id),
                eq(backgroundTasks.lease_owner, workerId),
                eq(backgroundTasks.status, 'running'),
              ),
            )
            .returning({ id: backgroundTasks.id });
          return rows.length > 0;
        });

      const fail = (
        id: string,
        workerId: string,
        error: string,
        retryable: boolean,
        retryDelayMs: number,
      ): Effect.Effect<boolean, TasksInfrastructureError> =>
        tryAsync('fail background task', async () => {
          const result = await db.execute(sql`
            UPDATE background_tasks
            SET
              status = CASE
                WHEN ${retryable} AND attempt_count < max_attempts THEN 'queued'
                ELSE 'failed'
              END,
              run_after = CASE
                WHEN ${retryable} AND attempt_count < max_attempts
                  THEN now() + (${retryInterval(retryDelayMs)})
                ELSE run_after
              END,
              payload = CASE
                WHEN ${retryable} AND attempt_count < max_attempts THEN payload
                ELSE NULL
              END,
              result = NULL,
              error = ${error},
              lease_owner = NULL,
              lease_expires_at = NULL,
              completed_at = CASE
                WHEN ${retryable} AND attempt_count < max_attempts THEN completed_at
                ELSE now()
              END,
              updated_at = now()
            WHERE id = ${id}
              AND lease_owner = ${workerId}
              AND status = 'running'
            RETURNING id
          `);
          return rowsOf<{ id: string }>(result).length > 0;
        });

      const recoverExpired = (
        retryDelayMs: number,
      ): Effect.Effect<number, TasksInfrastructureError> =>
        tryAsync('recover expired task leases', async () => {
          const result = await db.execute(sql`
            WITH recovered AS (
              UPDATE background_tasks
              SET
                status = CASE
                  WHEN cancel_requested_at IS NOT NULL THEN 'canceled'
                  WHEN attempt_count < max_attempts THEN 'queued'
                  ELSE 'failed'
                END,
                run_after = CASE
                  WHEN cancel_requested_at IS NULL AND attempt_count < max_attempts
                    THEN now() + (${retryInterval(retryDelayMs)})
                  ELSE run_after
                END,
                payload = CASE
                  WHEN cancel_requested_at IS NULL AND attempt_count < max_attempts
                    THEN payload
                  ELSE NULL
                END,
                result = NULL,
                error = CASE
                  WHEN cancel_requested_at IS NOT NULL THEN 'Task canceled after lease expired'
                  WHEN attempt_count < max_attempts THEN 'Task lease expired; retry scheduled'
                  ELSE 'Task lease expired and attempts are exhausted'
                END,
                lease_owner = NULL,
                lease_expires_at = NULL,
                completed_at = CASE
                  WHEN cancel_requested_at IS NOT NULL OR attempt_count >= max_attempts
                    THEN now()
                  ELSE completed_at
                END,
                updated_at = now()
              WHERE status = 'running'
                AND lease_expires_at <= now()
              RETURNING id
            )
            SELECT count(*)::int AS count FROM recovered
          `);
          return rowsOf<{ count: number }>(result)[0]?.count ?? 0;
        });

      return {
        enqueue,
        findAllPaginated,
        findById,
        cancel,
        claimNext,
        heartbeat,
        reportProgress,
        isCancelRequested,
        complete,
        markCanceled,
        fail,
        recoverExpired,
      };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
