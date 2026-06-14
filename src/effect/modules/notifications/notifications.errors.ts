import { InternalError } from '../../platform/domain-errors';

export class NotificationsInfrastructureError extends InternalError(
  'NotificationsInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}

export class NotificationSendError extends InternalError(
  'NotificationSendError',
)<{
  readonly channel: string;
  readonly cause?: unknown;
}> {}
