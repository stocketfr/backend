import { TaskStatus } from '@stocket/types/tasks';

const terminalStatuses: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.SUCCEEDED,
  TaskStatus.FAILED,
  TaskStatus.CANCELED,
]);

export const isTerminalTaskStatus = (status: TaskStatus): boolean =>
  terminalStatuses.has(status);

export const taskProgressPercent = (
  processed: number,
  total: number | null,
): number | null => {
  if (total === null || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((processed / total) * 100)));
};
