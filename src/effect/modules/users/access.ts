import { Effect } from 'effect';
import {
  requireRequestTenantId,
  type TenantNotResolved,
} from '../../platform/tenancy/tenant-context';
import type { UsersRepository } from './repository';
import { UserNotFound, type UsersInfrastructureError } from './users.errors';
import type { BetterAuthUser } from './types';

export type UserAccessRepository = Pick<
  UsersRepository,
  'findBetterAuthUser' | 'hasTenantMembership'
>;

export const getBetterAuthUserOrFail = (
  repository: UserAccessRepository,
  id: string,
): Effect.Effect<BetterAuthUser, UserNotFound | UsersInfrastructureError> =>
  Effect.gen(function* () {
    const user = yield* repository.findBetterAuthUser(id);
    return user
      ? yield* Effect.succeed(user)
      : yield* Effect.fail(
          new UserNotFound({
            id,
            messageKey: 'users.notFound',
          }),
        );
  });

export const requireTenantMemberOrFail = (
  repository: UserAccessRepository,
  userId: string,
): Effect.Effect<
  string,
  UserNotFound | UsersInfrastructureError | TenantNotResolved
> =>
  Effect.gen(function* () {
    const tenantId = yield* requireRequestTenantId;
    const hasTenantMembership = yield* repository.hasTenantMembership(
      userId,
      tenantId,
    );

    yield* Effect.filterOrFail(
      Effect.succeed(hasTenantMembership),
      Boolean,
      () =>
        new UserNotFound({
          id: userId,
          messageKey: 'users.notFound',
        }),
    );

    return tenantId;
  });
