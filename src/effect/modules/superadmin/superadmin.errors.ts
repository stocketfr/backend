import {
  BadRequestError,
  ConflictError,
  InternalError,
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

export class SuperAdminTenantImportInvalid extends BadRequestError(
  'SuperAdminTenantImportInvalid',
)<{
  readonly filename?: string;
  readonly details: string;
  readonly cause?: unknown;
}> {}

export class SuperAdminTenantImportReadFailed extends InternalError(
  'SuperAdminTenantImportReadFailed',
)<{
  readonly filename?: string;
  readonly cause?: unknown;
}> {}

export class SuperAdminRepositoryError extends InternalError(
  'SuperAdminRepositoryError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
