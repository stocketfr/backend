import { Effect } from 'effect';
import { asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { SortOrder } from '@stocket/types/common';
import { TaskStatus, type TaskQueryDto } from '@stocket/types/tasks';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
} from '@stocket/types/common';
import { makeTenantCrud } from '../../platform/db/tenant-crud';
import { insertOrGet } from '../../platform/db/insert-or-get';
import { backgroundTasks } from '../../platform/db/schema';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import { TasksInfrastructureError } from './tasks.errors';
import type { EnqueueTaskOptions, TaskEnqueueRecordResult } from './types';

const buildTaskFilters = (query: TaskQueryDto, actorId: string): SQL[] => {
  const filters: SQL[] = [eq(backgroundTasks.created_by, actorId)];
  if (query.type !== undefined) {
    filters.push(eq(backgroundTasks.type, query.type));
  }
  if (query.status !== undefined) {
    filters.push(eq(backgroundTasks.status, query.status));
  }
  return filters;
};

export class TasksRepository extends Effect.Service<TasksRepository>()(
  '@stocket/effect/tasks/TasksRepository',
  {
    effect: makeTenantCrud(backgroundTasks, {
      entity: 'background task',
      reads: false,
      onError: (action, cause) =>
        new TasksInfrastructureError({
          action,
          cause,
          messageKey: 'tasks.repositoryFailed',
        }),
      extras: ({ db, tryAsync, scopedWhere, scopedWhereId, insertValues }) => {
        const enqueue = (options: EnqueueTaskOptions) =>
          Effect.gen(function* () {
            const values = yield* insertValues({
              type: options.type,
              status: TaskStatus.QUEUED,
              payload: options.payload,
              created_by: options.createdBy,
              idempotency_key: options.idempotencyKey ?? null,
              max_attempts: options.maxAttempts ?? 3,
              run_after: options.runAfter ?? new Date(),
              progress_total: options.progress?.total ?? null,
              progress_message_key: options.progress?.messageKey ?? null,
              progress_message_args: options.progress?.messageArgs ?? null,
            });
            const existingWhere =
              options.idempotencyKey === undefined
                ? null
                : yield* scopedWhere(
                    eq(backgroundTasks.created_by, options.createdBy),
                    eq(backgroundTasks.type, options.type),
                    eq(backgroundTasks.idempotency_key, options.idempotencyKey),
                  );

            return yield* tryAsync(
              'enqueue background task',
              async (): Promise<TaskEnqueueRecordResult> => {
                const result = await insertOrGet({
                  insert: async () => {
                    const [inserted] = await db
                      .insert(backgroundTasks)
                      .values(values)
                      .onConflictDoNothing()
                      .returning();
                    return inserted;
                  },
                  getExisting: async () => {
                    if (existingWhere === null) return undefined;
                    const [found] = await db
                      .select()
                      .from(backgroundTasks)
                      .where(existingWhere)
                      .limit(1);
                    return found;
                  },
                  unresolvedConflictError: () =>
                    new Error('Background task insert returned no row'),
                });
                return {
                  task: result.value,
                  disposition: result.disposition,
                };
              },
            );
          });

        const findAllPaginatedForActor = (
          query: TaskQueryDto,
          actorId: string,
        ) =>
          Effect.gen(function* () {
            const where = yield* scopedWhere(
              ...buildTaskFilters(query, actorId),
            );
            const { page, limit, skip } = resolvePaginationWindow(
              query.page,
              query.limit,
            );

            return yield* tryAsync('list background tasks', async () => {
              const [totalRow] = await db
                .select({ total: count() })
                .from(backgroundTasks)
                .where(where);
              const data = await db
                .select()
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
                data,
                totalRow?.total ?? 0,
                page,
                limit,
              );
            });
          });

        const findByIdForActor = (id: string, actorId: string) =>
          Effect.gen(function* () {
            const where = yield* scopedWhereId(
              id,
              eq(backgroundTasks.created_by, actorId),
            );
            return yield* tryAsync('load background task', async () => {
              const [task] = await db
                .select()
                .from(backgroundTasks)
                .where(where)
                .limit(1);
              return task ?? null;
            });
          });

        const requestCancellation = (id: string, actorId: string) =>
          Effect.gen(function* () {
            const where = yield* scopedWhereId(
              id,
              eq(backgroundTasks.created_by, actorId),
              inArray(backgroundTasks.status, [
                TaskStatus.QUEUED,
                TaskStatus.RUNNING,
              ]),
            );

            return yield* tryAsync('cancel background task', async () => {
              const [task] = await db
                .update(backgroundTasks)
                .set({
                  status: sql`CASE
                    WHEN ${backgroundTasks.status} = ${TaskStatus.QUEUED}
                      THEN ${TaskStatus.CANCELED}
                    ELSE ${backgroundTasks.status}
                  END`,
                  cancel_requested_at: sql`COALESCE(${backgroundTasks.cancel_requested_at}, now())`,
                  completed_at: sql`CASE
                    WHEN ${backgroundTasks.status} = ${TaskStatus.QUEUED}
                      THEN now()
                    ELSE ${backgroundTasks.completed_at}
                  END`,
                  payload: sql`CASE
                    WHEN ${backgroundTasks.status} = ${TaskStatus.QUEUED}
                      THEN NULL
                    ELSE ${backgroundTasks.payload}
                  END`,
                  error: sql`CASE
                    WHEN ${backgroundTasks.status} = ${TaskStatus.QUEUED}
                      THEN 'Task canceled before execution'
                    ELSE ${backgroundTasks.error}
                  END`,
                  updated_at: new Date(),
                })
                .where(where)
                .returning();
              return task ?? null;
            });
          });

        return {
          enqueue,
          findAllPaginatedForActor,
          findByIdForActor,
          requestCancellation,
        };
      },
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
