import { InternalError, NotFoundError } from '../../platform/effect/domain-errors';

export class UserNotFound extends NotFoundError('UserNotFound')<{
  readonly id: string;
}> {}

export class UsersInfrastructureError extends InternalError(
  'UsersInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
