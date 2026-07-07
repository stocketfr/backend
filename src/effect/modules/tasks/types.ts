import { Schema } from 'effect';
import {
  LimitSchema,
  PageSchema,
  SortOrder,
  type PaginationMeta,
} from '@stocket/types/common';
import type { ProductImportResultDto } from '@stocket/types/products';
import type {
  AnyMessageKey,
  MessageArgs,
} from '../../platform/observability/messages';

export type TaskStatusDto =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export type TaskTypeDto = 'product-import';

export interface TaskQueryDto {
  readonly page?: number;
  readonly limit?: number;
  readonly type?: TaskTypeDto;
  readonly status?: TaskStatusDto;
  readonly sort_order?: SortOrder;
}

export interface TaskProgressDto {
  readonly total: number | null;
  readonly processed: number;
  readonly failed: number;
  readonly percent: number | null;
  readonly message: string | null;
  readonly messageKey?: AnyMessageKey;
  readonly messageArgs?: MessageArgs;
}

export type TaskResultDto = ProductImportResultDto | null;

export interface TaskResponseDto {
  readonly id: string;
  readonly tenant_id: string;
  readonly type: TaskTypeDto;
  readonly status: TaskStatusDto;
  readonly result: TaskResultDto;
  readonly error: string | null;
  readonly created_by: string | null;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly run_after: Date;
  readonly progress: TaskProgressDto;
  readonly cancel_requested_at: Date | null;
  readonly started_at: Date | null;
  readonly completed_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface PaginatedTasksResponseDto {
  readonly data: TaskResponseDto[];
  readonly meta: PaginationMeta;
}

export const TaskStatuses = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
] as const satisfies readonly TaskStatusDto[];

export const TaskTypes = [
  'product-import',
] as const satisfies readonly TaskTypeDto[];

export const TerminalTaskStatuses = [
  'succeeded',
  'failed',
  'canceled',
] as const satisfies readonly TaskStatusDto[];

export const TaskIdSchema = Schema.UUID;

export const TaskStatusSchema = Schema.Literal(...TaskStatuses);

export const TaskTypeSchema = Schema.Literal(...TaskTypes);

export const TaskQuerySchema = Schema.Struct({
  page: Schema.optional(PageSchema),
  limit: Schema.optional(LimitSchema),
  type: Schema.optional(TaskTypeSchema),
  status: Schema.optional(TaskStatusSchema),
  sort_order: Schema.optional(Schema.Literal(SortOrder.ASC, SortOrder.DESC)),
});

export interface TaskRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly type: string;
  readonly status: TaskStatusDto;
  readonly payload?: unknown;
  readonly result: unknown | null;
  readonly error: string | null;
  readonly created_by: string | null;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly run_after: Date;
  readonly lease_owner: string | null;
  readonly lease_expires_at: Date | null;
  readonly progress_total: number | null;
  readonly progress_processed: number;
  readonly progress_failed: number;
  readonly progress_message: string | null;
  readonly cancel_requested_at: Date | null;
  readonly started_at: Date | null;
  readonly completed_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface EnqueueTaskParams {
  readonly type: TaskTypeDto;
  readonly payload: unknown;
  readonly createdBy: string | null;
  readonly maxAttempts?: number;
  readonly runAfter?: Date;
  readonly progressTotal?: number | null;
  readonly progressMessage?: string | null;
}

export interface ClaimTaskOptions {
  readonly workerId: string;
  readonly leaseMs: number;
}

export interface ClaimedTask {
  readonly row: TaskRow;
  readonly workerId: string;
}

export interface TaskProgressPatch {
  readonly total?: number | null;
  readonly processed?: number;
  readonly failed?: number;
  readonly message?: string | null;
}

export interface TaskExecutionContext {
  readonly task: TaskRow;
  readonly workerId: string;
  readonly reportProgress: (
    patch: TaskProgressPatch,
  ) => import('effect').Effect.Effect<void, never, never>;
  readonly isCancelRequested: import('effect').Effect.Effect<
    boolean,
    never,
    never
  >;
}

export type TaskHandlerOutcome =
  | { readonly _tag: 'succeeded'; readonly result: unknown | null }
  | { readonly _tag: 'canceled'; readonly error?: string }
  | {
      readonly _tag: 'failed';
      readonly error: string;
      readonly retryable: boolean;
    };

export interface TaskHandler {
  readonly run: (
    task: TaskRow,
    context: TaskExecutionContext,
  ) => import('effect').Effect.Effect<TaskHandlerOutcome, never, never>;
}
