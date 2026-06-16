import { NotFoundError, BadRequestError, InternalError } from '../../platform/effect/domain-errors';

export class CategoryNotFound extends NotFoundError('CategoryNotFound')<{ readonly id: string }> {}

export class ParentCategoryNotFound extends BadRequestError('ParentCategoryNotFound')<{
  readonly parentId: string;
}> {}

export class CategoryNameAlreadyExists extends BadRequestError('CategoryNameAlreadyExists')<{
  readonly name: string;
  readonly parentId?: string | null;
}> {}

export class CategorySelfParent extends BadRequestError('CategorySelfParent')<{ readonly id: string }> {}

export class CategoryCircularReference extends BadRequestError('CategoryCircularReference')<{
  readonly id: string;
  readonly parentId: string;
}> {}

export class CategoriesInfrastructureError extends InternalError('CategoriesInfrastructureError')<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
