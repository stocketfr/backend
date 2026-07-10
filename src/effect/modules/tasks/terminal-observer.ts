import { Context, type Effect } from 'effect';
import type { TaskRow } from './types';

export interface TaskTerminalEvent {
  readonly task: TaskRow;
  readonly originalPayload: unknown;
}

export interface TaskTerminalObserverShape {
  readonly onSettled: (event: TaskTerminalEvent) => Effect.Effect<void>;
}

export class TaskTerminalObserver extends Context.Tag(
  '@stocket/effect/tasks/TaskTerminalObserver',
)<TaskTerminalObserver, TaskTerminalObserverShape>() {}
