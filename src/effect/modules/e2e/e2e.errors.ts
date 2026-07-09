import {
  ForbiddenError,
  InternalError,
} from '../../platform/effect/domain-errors';

export class E2eSeedDisabled extends ForbiddenError('E2eSeedDisabled') {}
export class E2eSeedFailed extends InternalError('E2eSeedFailed')<{
  readonly cause: unknown;
}> {}
