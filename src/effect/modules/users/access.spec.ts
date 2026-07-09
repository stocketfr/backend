import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { CurrentRequestContext } from '../../platform/http/request-context';
import {
  getBetterAuthUserOrFail,
  requireTenantMemberOrFail,
  type UserAccessRepository,
} from './access';

const tenantId = '00000000-0000-4000-8000-000000000001';
const requestContext = {
  requestId: '00000000-0000-4000-8000-000000000099',
  path: '/api/v1/users',
  method: 'GET' as const,
  ip: null,
  locale: 'en' as const,
  tenantId,
};

type AccessUser = NonNullable<
  Effect.Effect.Success<ReturnType<UserAccessRepository['findBetterAuthUser']>>
>;

const user: AccessUser = {
  id: 'user-1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  image: null,
  banned: false,
  banReason: null,
  banExpires: null,
  createdAt: new Date('2026-03-01T00:00:00.000Z'),
};

const makeRepository = (
  overrides: Partial<UserAccessRepository> = {},
): UserAccessRepository => ({
  findBetterAuthUser: () => Effect.succeed(user),
  hasTenantMembership: () => Effect.succeed(true),
  ...overrides,
});

const withTenantContext = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(CurrentRequestContext, requestContext));

describe('user access helpers', () => {
  it.effect('loads a Better Auth user or fails with UserNotFound', () =>
    Effect.gen(function* () {
      const repository = makeRepository();

      const found = yield* getBetterAuthUserOrFail(repository, 'user-1');
      const missing = yield* Effect.flip(
        getBetterAuthUserOrFail(
          makeRepository({
            findBetterAuthUser: () => Effect.succeed(null),
          }),
          'missing',
        ),
      );

      expect(found).toEqual(user);
      expect(missing).toMatchObject({
        _tag: 'UserNotFound',
        id: 'missing',
      });
    }),
  );

  it.effect('returns the current tenant id when the user is a member', () =>
    Effect.gen(function* () {
      let membershipCheck:
        | { readonly userId: string; readonly tenantId: string }
        | undefined;
      const repository = makeRepository({
        hasTenantMembership: (userId, checkedTenantId) =>
          Effect.sync(() => {
            membershipCheck = { userId, tenantId: checkedTenantId };
            return true;
          }),
      });

      const result = yield* withTenantContext(
        requireTenantMemberOrFail(repository, 'user-1'),
      );

      expect(result).toBe(tenantId);
      expect(membershipCheck).toEqual({
        userId: 'user-1',
        tenantId,
      });
    }),
  );

  it.effect(
    'fails with UserNotFound when the user is not a tenant member',
    () =>
      Effect.gen(function* () {
        const repository = makeRepository({
          hasTenantMembership: () => Effect.succeed(false),
        });

        const error = yield* Effect.flip(
          withTenantContext(requireTenantMemberOrFail(repository, 'user-1')),
        );

        expect(error).toMatchObject({
          _tag: 'UserNotFound',
          id: 'user-1',
        });
      }),
  );
});
