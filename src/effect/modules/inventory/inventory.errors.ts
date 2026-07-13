import { ErrorCode } from '@stocket/types/common';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '../../platform/effect/domain-errors';

export class InventoryNotFound extends NotFoundError('InventoryNotFound')<{
  readonly id: string;
}> {}

export class InventoryProductNotFound extends NotFoundError(
  'InventoryProductNotFound',
)<{
  readonly productId: string;
}> {}

export class InventoryLocationNotFound extends NotFoundError(
  'InventoryLocationNotFound',
)<{
  readonly locationId: string;
}> {}

export class InvalidInventoryProduct extends BadRequestError(
  'InvalidInventoryProduct',
)<{
  readonly productId: string;
}> {}

export class InvalidInventoryLocation extends BadRequestError(
  'InvalidInventoryLocation',
)<{
  readonly locationId: string;
}> {}

export class InvalidInventoryArea extends BadRequestError(
  'InvalidInventoryArea',
)<{
  readonly areaId: string;
}> {}

export class InventoryAreaLocationMismatch extends BadRequestError(
  'InventoryAreaLocationMismatch',
)<{
  readonly areaId: string;
  readonly locationId: string;
}> {}

export class InventoryAlreadyExists extends BadRequestError(
  'InventoryAlreadyExists',
  ErrorCode.INVENTORY_DUPLICATE_LOCATION,
)<{
  readonly productId: string;
  readonly locationId: string;
  readonly areaId?: string | null;
}> {}

export class InventoryQuantityAdjustmentFailed extends BadRequestError(
  'InventoryQuantityAdjustmentFailed',
  ErrorCode.INVENTORY_NEGATIVE_QUANTITY,
)<{
  readonly id: string;
  readonly adjustment: number;
}> {}

export class InventoryInfrastructureError extends InternalError(
  'InventoryInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
