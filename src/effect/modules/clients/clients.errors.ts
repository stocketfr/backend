import {
  NotFoundError,
  ConflictError,
  InternalError,
} from '../../platform/effect/domain-errors';

export class ClientNotFound extends NotFoundError('ClientNotFound')<{
  readonly id: string;
}> {}

export class ClientEmailAlreadyExists extends ConflictError(
  'ClientEmailAlreadyExists',
)<{
  readonly email: string;
}> {}

export class ClientsInfrastructureError extends InternalError(
  'ClientsInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
