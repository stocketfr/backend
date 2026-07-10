import { TaskStatus } from '@stocket/types/tasks';
import type { TaskRow } from '../types';

export const TASK_ID = '10000000-0000-4000-8000-000000000001';
export const TASK_ACTOR_ID = '20000000-0000-4000-a000-000000000001';

const now = new Date('2026-07-10T10:00:00.000Z');

export const makeTaskRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: TASK_ID,
  tenant_id: '00000000-0000-4000-8000-000000000001',
  type: 'test-task',
  status: TaskStatus.QUEUED,
  payload: { value: 'test' },
  result: null,
  error: null,
  created_by: TASK_ACTOR_ID,
  idempotency_key: null,
  attempt_count: 0,
  max_attempts: 3,
  run_after: now,
  lease_owner: null,
  lease_token: null,
  lease_expires_at: null,
  progress_total: null,
  progress_processed: 0,
  progress_failed: 0,
  progress_message_key: null,
  progress_message_args: null,
  cancel_requested_at: null,
  started_at: null,
  completed_at: null,
  created_at: now,
  updated_at: now,
  ...overrides,
});
