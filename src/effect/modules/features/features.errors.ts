import type { FeatureKey } from '@stocket/types/features';
import {
  ForbiddenError,
  InternalError,
  NotFoundError,
} from '../../platform/effect/domain-errors';

export class FeatureNotEnabled extends ForbiddenError('FeatureNotEnabled')<{
  readonly featureKey: FeatureKey;
}> {}

export class FeatureTenantNotFound extends NotFoundError(
  'FeatureTenantNotFound',
)<{
  readonly tenantId: string;
}> {}

export class FeaturesInfrastructureError extends InternalError(
  'FeaturesInfrastructureError',
)<{
  readonly action: string;
  readonly cause?: unknown;
}> {}
