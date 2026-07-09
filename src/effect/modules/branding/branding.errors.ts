import {
  InternalError,
  UnauthorizedError,
} from '../../platform/effect/domain-errors';

export class BrandingInfrastructureError extends InternalError(
  'BrandingInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}

export class BrandingUnauthorized extends UnauthorizedError(
  'BrandingUnauthorized',
) {}
