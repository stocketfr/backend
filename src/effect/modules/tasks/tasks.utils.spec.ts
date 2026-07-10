import { TaskStatus } from '@stocket/types/tasks';
import { isTerminalTaskStatus, taskProgressPercent } from './tasks.utils';

describe('task utilities', () => {
  it.each([
    [TaskStatus.QUEUED, false],
    [TaskStatus.RUNNING, false],
    [TaskStatus.SUCCEEDED, true],
    [TaskStatus.FAILED, true],
    [TaskStatus.CANCELED, true],
  ])('classifies %s terminal state as %s', (status, expected) => {
    expect(isTerminalTaskStatus(status)).toBe(expected);
  });

  it('calculates and clamps progress percentages', () => {
    expect(taskProgressPercent(2, 8)).toBe(25);
    expect(taskProgressPercent(12, 8)).toBe(100);
    expect(taskProgressPercent(-1, 8)).toBe(0);
    expect(taskProgressPercent(0, null)).toBeNull();
    expect(taskProgressPercent(0, 0)).toBeNull();
  });
});
