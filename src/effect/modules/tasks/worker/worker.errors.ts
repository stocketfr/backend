import { Data } from 'effect';

export class TaskHandlerNotFound extends Data.TaggedError(
  'TaskHandlerNotFound',
)<{
  readonly taskType: string;
}> {}

export class TaskPayloadInvalid extends Data.TaggedError('TaskPayloadInvalid')<{
  readonly details: string;
}> {}

export class TaskExecutionFailed extends Data.TaggedError(
  'TaskExecutionFailed',
)<{
  readonly error: string;
  readonly retryable: boolean;
}> {}

export class TaskExecutionCanceled extends Data.TaggedError(
  'TaskExecutionCanceled',
)<{
  readonly reason: string;
}> {}

export class TaskLeaseLost extends Data.TaggedError('TaskLeaseLost')<{
  readonly taskId: string;
}> {}

export type TaskHandlerError =
  | TaskPayloadInvalid
  | TaskExecutionFailed
  | TaskExecutionCanceled;
