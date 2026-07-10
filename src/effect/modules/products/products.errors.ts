import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '../../platform/effect/domain-errors';

export class ProductNotFound extends NotFoundError('ProductNotFound')<{
  readonly productId: string;
}> {}

export class CategoryNotFound extends NotFoundError('CategoryNotFound')<{
  readonly categoryId: string;
}> {}

export class SkuAlreadyExists extends BadRequestError('SkuAlreadyExists')<{
  readonly sku: string;
}> {}

export class PriceBelowCost extends BadRequestError('PriceBelowCost')<{
  readonly standardPrice: number;
  readonly standardCost: number;
}> {}

export class ProductNotDeleted extends BadRequestError('ProductNotDeleted')<{
  readonly productId: string;
}> {}

export class ProductImportUnsupportedFormat extends BadRequestError(
  'ProductImportUnsupportedFormat',
)<{}> {}

export class ProductImportCsvParseFailed extends BadRequestError(
  'ProductImportCsvParseFailed',
)<{
  readonly cause?: unknown;
}> {}

export class ProductImportPlanParseFailed extends BadRequestError(
  'ProductImportPlanParseFailed',
)<{
  readonly cause?: unknown;
}> {}

export class ProductImportGuidanceParseFailed extends BadRequestError(
  'ProductImportGuidanceParseFailed',
)<{
  readonly cause?: unknown;
}> {}

export class ProductImportProposalInvalid extends BadRequestError(
  'ProductImportProposalInvalid',
)<{
  readonly cause?: unknown;
}> {}

export class ProductImportCancelled extends BadRequestError(
  'ProductImportCancelled',
)<{}> {}

export class ProductsInfrastructureError extends InternalError(
  'ProductInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
