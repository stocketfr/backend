import type { TaskResponseDto } from '@stocket/types/tasks';
import type { TaskRow } from './types';

export const rowsOf = <A>(result: unknown): A[] =>
  ((result as { rows?: A[] }).rows ?? (result as A[])) as A[];

const percentFromCounts = (
  processed: number,
  total: number | null,
): number | null => {
  if (total === null || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((processed / total) * 100)));
};

export const toTaskResponseDto = (task: TaskRow): TaskResponseDto => ({
  id: task.id,
  tenant_id: task.tenant_id,
  type: task.type as TaskResponseDto['type'],
  status: task.status,
  result: (task.result ?? null) as TaskResponseDto['result'],
  error: task.error,
  created_by: task.created_by,
  attempt_count: task.attempt_count,
  max_attempts: task.max_attempts,
  run_after: task.run_after,
  progress: {
    total: task.progress_total,
    processed: task.progress_processed,
    failed: task.progress_failed,
    percent: percentFromCounts(task.progress_processed, task.progress_total),
    message: task.progress_message,
  },
  cancel_requested_at: task.cancel_requested_at,
  started_at: task.started_at,
  completed_at: task.completed_at,
  created_at: task.created_at,
  updated_at: task.updated_at,
});

export const describeTaskError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};
