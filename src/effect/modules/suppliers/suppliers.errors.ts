import { NotFoundError, InternalError } from '../../platform/effect/domain-errors';

export class SupplierNotFound extends NotFoundError('SupplierNotFound')<{
  readonly id: string;
}> {}

export class SuppliersInfrastructureError extends InternalError(
  'SuppliersInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
