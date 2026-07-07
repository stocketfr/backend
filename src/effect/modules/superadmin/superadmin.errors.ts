import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from '../../platform/effect/domain-errors';

export class InvalidTenantSlug extends BadRequestError('InvalidTenantSlug')<{
  readonly slug: string;
}> {}

export class ReservedTenantSlug extends BadRequestError('ReservedTenantSlug')<{
  readonly slug: string;
}> {}

export class TenantSlugAlreadyExists extends ConflictError(
  'TenantSlugAlreadyExists',
)<{
  readonly slug: string;
}> {}

export class TenantHostnameAlreadyExists extends ConflictError(
  'TenantHostnameAlreadyExists',
)<{
  readonly hostname: string;
}> {}

export class TenantNotFound extends NotFoundError('TenantNotFound')<{
  readonly tenantId: string;
}> {}

export class TenantImportInvalid extends BadRequestError(
  'TenantImportInvalid',
)<{
  readonly details: string;
  readonly cause?: unknown;
}> {}

export class SuperAdminRepositoryError extends InternalError(
  'SuperAdminRepositoryError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
