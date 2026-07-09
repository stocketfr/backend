import {
  NotFoundError,
  InternalError,
} from '../../platform/effect/domain-errors';

export class LocationNotFound extends NotFoundError('LocationNotFound')<{
  readonly id: string;
}> {}

export class LocationsInfrastructureError extends InternalError(
  'LocationsInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
