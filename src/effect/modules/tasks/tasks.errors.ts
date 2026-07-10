import {
  ConflictError,
  InternalError,
  NotFoundError,
} from '../../platform/effect/domain-errors';

export class TaskNotFound extends NotFoundError('TaskNotFound')<{
  readonly taskId: string;
}> {}

export class TaskTerminalConflict extends ConflictError(
  'TaskTerminalConflict',
)<{
  readonly taskId: string;
}> {}

export class TasksInfrastructureError extends InternalError(
  'TasksInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
