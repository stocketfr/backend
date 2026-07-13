import type { OrderStatus } from '@stocket/types/orders';
import { ErrorCode } from '@stocket/types/common';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '../../platform/effect/domain-errors';

export class OrderNotFound extends NotFoundError('OrderNotFound')<{
  readonly id: string;
}> {}

export class ClientNotFound extends BadRequestError('ClientNotFound')<{
  readonly clientId: string;
}> {}

export class InvalidOrderStatusTransition extends BadRequestError(
  'InvalidOrderStatusTransition',
  ErrorCode.ORDER_INVALID_TRANSITION,
)<{
  readonly from: OrderStatus;
  readonly to: OrderStatus;
}> {}

export class CannotDeleteNonDraftOrder extends BadRequestError(
  'CannotDeleteNonDraftOrder',
)<{
  readonly orderId: string;
  readonly status: OrderStatus;
}> {}

export class OrdersInfrastructureError extends InternalError(
  'OrdersInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
