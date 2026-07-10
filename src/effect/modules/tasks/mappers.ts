import type { TaskResponseDto } from '@stocket/types/tasks';
import {
  translateMessage,
  type SupportedLocale,
} from '../../platform/observability/messages';
import type { TaskRow } from './types';
import { taskProgressPercent } from './tasks.utils';

export const toTaskResponseDto = (
  task: TaskRow,
  locale: SupportedLocale,
): TaskResponseDto => {
  const messageKey = task.progress_message_key;
  const messageArgs = task.progress_message_args;

  return {
    id: task.id,
    type: task.type,
    status: task.status,
    result: task.result,
    error: task.error,
    attempt_count: task.attempt_count,
    max_attempts: task.max_attempts,
    run_after: task.run_after,
    progress: {
      total: task.progress_total,
      processed: task.progress_processed,
      failed: task.progress_failed,
      percent: taskProgressPercent(
        task.progress_processed,
        task.progress_total,
      ),
      message:
        messageKey === null
          ? null
          : translateMessage(locale, messageKey, messageArgs ?? undefined),
      message_key: messageKey,
      message_args: messageArgs,
    },
    cancel_requested_at: task.cancel_requested_at,
    started_at: task.started_at,
    completed_at: task.completed_at,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
};
