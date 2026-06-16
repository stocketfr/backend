import {
  NotFoundError,
  BadRequestError,
  ConflictError,
  InternalError,
} from '../../platform/effect/domain-errors';

export class RoleNotFound extends NotFoundError('RoleNotFound')<{
  readonly id: string;
}> {}

export class RoleNameAlreadyExists extends ConflictError(
  'RoleNameAlreadyExists',
)<{
  readonly name: string;
}> {}

export class SystemRoleDeletionForbidden extends BadRequestError(
  'SystemRoleDeletionForbidden',
)<{
  readonly id: string;
}> {}

export class RolesInfrastructureError extends InternalError(
  'RolesInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
