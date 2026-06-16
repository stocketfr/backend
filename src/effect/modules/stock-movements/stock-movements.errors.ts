import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '../../platform/effect/domain-errors';

export class StockMovementNotFound extends NotFoundError(
  'StockMovementNotFound',
)<{
  readonly id: string;
}> {}

export class StockMovementProductNotFound extends NotFoundError(
  'StockMovementProductNotFound',
)<{
  readonly productId: string;
}> {}

export class StockMovementLocationNotFound extends NotFoundError(
  'StockMovementLocationNotFound',
)<{
  readonly locationId: string;
}> {}

export class InvalidStockMovementProduct extends BadRequestError(
  'InvalidStockMovementProduct',
)<{
  readonly productId: string;
}> {}

export class InvalidSourceLocation extends BadRequestError(
  'InvalidSourceLocation',
)<{
  readonly locationId: string;
}> {}

export class InvalidDestinationLocation extends BadRequestError(
  'InvalidDestinationLocation',
)<{
  readonly locationId: string;
}> {}

export class InvalidStockMovementOrder extends BadRequestError(
  'InvalidStockMovementOrder',
)<{
  readonly orderId: string;
}> {}

export class StockMovementsInfrastructureError extends InternalError(
  'StockMovementsInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
