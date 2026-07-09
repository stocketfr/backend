import {
  NotFoundError,
  InternalError,
} from '../../platform/effect/domain-errors';

export class AuditLogNotFound extends NotFoundError('AuditLogNotFound')<{
  readonly id: string;
}> {}

export class AuditLogsInfrastructureError extends InternalError(
  'AuditLogsInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
