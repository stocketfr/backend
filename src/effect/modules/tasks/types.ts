import type {
  TaskProgressMessageArgs,
  TaskQueryDto,
  TaskResponseDto,
} from '@stocket/types/tasks';
import type { AnyMessageKey } from '../../platform/observability/messages';
import type { backgroundTasks } from '../../platform/db/schema';

export type TaskRow = typeof backgroundTasks.$inferSelect;

export interface EnqueueTaskOptions {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdBy: string;
  readonly idempotencyKey?: string;
  readonly maxAttempts?: number;
  readonly runAfter?: Date;
  readonly progress?: {
    readonly total?: number | null;
    readonly messageKey?: AnyMessageKey;
    readonly messageArgs?: TaskProgressMessageArgs;
  };
}

export type TaskEnqueueDisposition = 'created' | 'existing';

export interface TaskEnqueueRecordResult {
  readonly task: TaskRow;
  readonly disposition: TaskEnqueueDisposition;
}

export interface TaskEnqueueResult {
  readonly task: TaskResponseDto;
  readonly disposition: TaskEnqueueDisposition;
}

export interface ActorTaskQuery extends TaskQueryDto {
  readonly actorId: string;
}
