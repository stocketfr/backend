import type { OrderStatus } from '@stocket/types/orders';
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
  NotImplementedError,
} from '../../platform/effect/domain-errors';
import type { OrderStatusTransitionConflict } from '../orders/orders.errors';

export class FulfillmentOrderNotFound extends NotFoundError(
  'FulfillmentOrderNotFound',
)<{
  readonly orderId: string;
}> {}

export class FulfillmentInvalidTransition extends BadRequestError(
  'FulfillmentInvalidTransition',
)<{
  readonly orderId: string;
  readonly from: OrderStatus;
  readonly to: OrderStatus;
}> {}

export class FulfillmentPickFailed extends ConflictError(
  'FulfillmentPickFailed',
)<{
  readonly orderItemId: string;
}> {}

export class FulfillmentNotImplemented extends NotImplementedError(
  'FulfillmentNotImplemented',
)<{
  readonly operation: string;
}> {}

export class FulfillmentInfrastructureError extends InternalError(
  'FulfillmentInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}

export type FulfillmentError =
  | FulfillmentOrderNotFound
  | FulfillmentInvalidTransition
  | OrderStatusTransitionConflict
  | FulfillmentPickFailed
  | FulfillmentNotImplemented
  | FulfillmentInfrastructureError;
