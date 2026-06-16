import {
  NotFoundError,
  BadRequestError,
  InternalError,
} from '../../platform/effect/domain-errors';

export class AreaNotFound extends NotFoundError('AreaNotFound')<{
  readonly id: string;
}> {}

export class AreaLocationNotFound extends BadRequestError(
  'AreaLocationNotFound',
)<{
  readonly locationId: string;
}> {}

export class ParentAreaNotFound extends BadRequestError('ParentAreaNotFound')<{
  readonly parentId: string;
}> {}

export class AreaSelfParent extends BadRequestError('AreaSelfParent')<{
  readonly id: string;
}> {}

export class AreaParentLocationMismatch extends BadRequestError(
  'AreaParentLocationMismatch',
)<{
  readonly parentId: string;
  readonly locationId: string;
}> {}

export class AreaCircularReference extends BadRequestError(
  'AreaCircularReference',
)<{
  readonly id: string;
  readonly parentId: string;
}> {}

export class AreasInfrastructureError extends InternalError(
  'AreasInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
