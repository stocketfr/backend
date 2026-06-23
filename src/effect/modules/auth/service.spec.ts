/**
 * Unit tests for AuthService.
 *
 * AuthService is thin — each method delegates to `requireSession` and,
 * for `me`, to `RolesService.getPermissionsForUser`. We mock
 * `../../platform/session` (following `authorization.spec.ts`) so the
 * tests don't need an HTTP request context, and stub `RolesService`
 * with `makeTestLayer`.
 */
import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import {
  EntitlementSource,
  FeatureKey,
  PlanKey,
} from '@stocket/types/features';
import { makeTestLayer } from '../../testing/test-harness';
import { FeaturesService } from '../features/service';
import { RolesService, type UserPermissions } from '../roles/service';
import { AuthService } from './service';

// ---------------------------------------------------------------------------
// `requireSession` mock — tests override `mockRequireSession` per case.
// ---------------------------------------------------------------------------
const mockRequireSession = vi.fn();

vi.mock('../../platform/http/session', async () => {
  const { Effect } = await vi.importActual<typeof import('effect')>('effect');

  return {
    requireSession: Effect.suspend(() => mockRequireSession()),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const makeSession = (overrides: Record<string, any> = {}) => ({
  user: {
    id: 'user-1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    image: 'https://example.com/avatar.png',
    emailVerified: true,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-10T12:00:00.000Z'),
    role: 'admin',
    ...overrides.user,
  },
  session: {
    id: 'session-1',
    userId: 'user-1',
    token: 'tok',
    createdAt: new Date('2026-03-10T12:00:00.000Z'),
    updatedAt: new Date('2026-03-10T12:00:00.000Z'),
    expiresAt: new Date('2026-03-17T12:00:00.000Z'),
    ...overrides.session,
  },
});

const defaultUserPermissions: UserPermissions = {
  roleNames: ['Admin'],
  permissions: {
    [Resource.ROLES]: [Permission.READ, Permission.WRITE],
    [Resource.DASHBOARD]: [Permission.READ],
  },
};

// ---------------------------------------------------------------------------
// Layer helpers
// ---------------------------------------------------------------------------
const rolesLayer = (overrides: Partial<RolesService> = {}) =>
  makeTestLayer(RolesService)({
    getPermissionsForUser: () => Effect.succeed(defaultUserPermissions),
    ...overrides,
  });

const featuresLayer = (overrides: Partial<FeaturesService> = {}) =>
  makeTestLayer(FeaturesService)({
    getFeaturesForTenant: () =>
      Effect.succeed({
        tenantId: '00000000-0000-4000-8000-000000000001',
        planKey: PlanKey.FREE,
        source: EntitlementSource.SYSTEM,
        features: {
          [FeatureKey.SMART_IMPORT]: false,
          [FeatureKey.ORDERS]: true,
        },
        overrides: [],
        updated_at: null,
        updated_by: null,
      }),
    ...overrides,
  });

const serviceLayer = (roles = rolesLayer(), features = featuresLayer()) =>
  AuthService.DefaultWithoutDependencies.pipe(
    Layer.provide(Layer.mergeAll(roles, features)),
  );

const withService = <A, E, R>(
  body: (svc: AuthService) => Effect.Effect<A, E, R>,
  rolesOverrides?: Partial<RolesService>,
  featuresOverrides?: Partial<FeaturesService>,
): Effect.Effect<A, E, never> =>
  // `requireSession` is replaced by the `vi.mock` above, so its residual
  // `BetterAuthService | HttpServerRequest` requirements are discharged at
  // runtime. TS can't see the mock's replacement, so we narrow R here — the
  // same pattern used in `platform/authorization.spec.ts`.
  Effect.gen(function* () {
    const svc = yield* AuthService;
    return yield* body(svc);
  }).pipe(
    Effect.provide(
      serviceLayer(
        rolesLayer(rolesOverrides),
        featuresLayer(featuresOverrides),
      ),
    ),
  ) as unknown as Effect.Effect<A, E, never>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('me', () => {
    it.effect(
      'returns current user with roles + permissions from RolesService',
      () => {
        mockRequireSession.mockReturnValue(Effect.succeed(makeSession()));

        return withService((svc) =>
          Effect.gen(function* () {
            const result = yield* svc.me();
            expect(result).toEqual({
              id: 'user-1',
              name: 'Jane Doe',
              email: 'jane@example.com',
              image: 'https://example.com/avatar.png',
              tenantId: '00000000-0000-4000-8000-000000000001',
              tenantName: 'Stocket',
              tenantSlug: 'stocket',
              planKey: PlanKey.FREE,
              features: {
                [FeatureKey.SMART_IMPORT]: false,
                [FeatureKey.ORDERS]: true,
              },
              roles: ['Admin'],
              permissions: {
                [Resource.ROLES]: [Permission.READ, Permission.WRITE],
                [Resource.DASHBOARD]: [Permission.READ],
              },
            });
          }),
        );
      },
    );

    it.effect(
      'forwards session.user.id to RolesService.getPermissionsForUser',
      () => {
        mockRequireSession.mockReturnValue(
          Effect.succeed(makeSession({ user: { id: 'user-42' } })),
        );
        const getPermissionsForUser = vi
          .fn()
          .mockReturnValue(Effect.succeed(defaultUserPermissions));

        return withService(
          (svc) =>
            Effect.gen(function* () {
              yield* svc.me();
              expect(getPermissionsForUser).toHaveBeenCalledWith(
                'user-42',
                '00000000-0000-4000-8000-000000000001',
              );
            }),
          { getPermissionsForUser },
        );
      },
    );

    it.effect('maps missing image to undefined', () => {
      mockRequireSession.mockReturnValue(
        Effect.succeed(makeSession({ user: { image: null } })),
      );

      return withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.me();
          expect(result.image).toBeUndefined();
        }),
      );
    });

    it.effect(
      'propagates SessionUnauthorized when requireSession fails',
      () => {
        mockRequireSession.mockReturnValue(
          Effect.fail({
            _tag: 'SessionUnauthorized',
            messageKey: 'auth.unauthorized',
            message: 'Unauthorized',
            statusCode: 401,
          }),
        );

        return withService((svc) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(svc.me());
            expect(error).toMatchObject({
              _tag: 'SessionUnauthorized',
              statusCode: 401,
            });
          }),
        );
      },
    );

    it.effect(
      'propagates errors from RolesService.getPermissionsForUser',
      () => {
        mockRequireSession.mockReturnValue(Effect.succeed(makeSession()));

        return withService(
          (svc) =>
            Effect.gen(function* () {
              const error = yield* Effect.flip(svc.me());
              expect(error).toMatchObject({
                _tag: 'RolesInfrastructureError',
              });
            }),
          {
            getPermissionsForUser: () =>
              Effect.fail({
                _tag: 'RolesInfrastructureError',
                statusCode: 500,
                message: 'boom',
                messageKey: 'roles.loadPermissionsFailed',
              } as any),
          },
        );
      },
    );
    it.effect('returns features from FeaturesService', () => {
      mockRequireSession.mockReturnValue(Effect.succeed(makeSession()));
      const features = {
        [FeatureKey.SMART_IMPORT]: true,
        [FeatureKey.ORDERS]: true,
      };
      const getFeaturesForTenant = vi.fn().mockReturnValue(
        Effect.succeed({
          tenantId: '00000000-0000-4000-8000-000000000001',
          planKey: PlanKey.FREE,
          source: EntitlementSource.MANUAL,
          features,
          overrides: [],
          updated_at: null,
          updated_by: null,
        }),
      );

      return withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.me();

            expect(getFeaturesForTenant).toHaveBeenCalledWith(
              '00000000-0000-4000-8000-000000000001',
            );
            expect(result.features).toEqual(features);
          }),
        undefined,
        { getFeaturesForTenant },
      );
    });

    it.effect(
      'propagates errors from FeaturesService.getFeaturesForTenant',
      () => {
        mockRequireSession.mockReturnValue(Effect.succeed(makeSession()));

        return withService(
          (svc) =>
            Effect.gen(function* () {
              const error = yield* Effect.flip(svc.me());
              expect(error).toMatchObject({
                _tag: 'FeaturesInfrastructureError',
              });
            }),
          undefined,
          {
            getFeaturesForTenant: () =>
              Effect.fail({
                _tag: 'FeaturesInfrastructureError',
                statusCode: 500,
                message: 'boom',
                messageKey: 'features.repositoryFailed',
              } as any),
          },
        );
      },
    );
  });

  describe('profile', () => {
    it.effect('returns the mapped profile payload', () => {
      mockRequireSession.mockReturnValue(Effect.succeed(makeSession()));

      return withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.profile();
          expect(result).toEqual({
            id: 'user-1',
            name: 'Jane Doe',
            email: 'jane@example.com',
            image: 'https://example.com/avatar.png',
            createdAt: '2026-03-01T10:00:00.000Z',
            updatedAt: '2026-03-10T12:00:00.000Z',
          });
        }),
      );
    });

    it.effect('omits image when the user has none', () => {
      mockRequireSession.mockReturnValue(
        Effect.succeed(makeSession({ user: { image: null } })),
      );

      return withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.profile();
          expect(result.image).toBeUndefined();
        }),
      );
    });

    it.effect('does not call RolesService', () => {
      mockRequireSession.mockReturnValue(Effect.succeed(makeSession()));
      const getPermissionsForUser = vi.fn();

      return withService(
        (svc) =>
          Effect.gen(function* () {
            yield* svc.profile();
            expect(getPermissionsForUser).not.toHaveBeenCalled();
          }),
        { getPermissionsForUser },
      );
    });

    it.effect(
      'propagates SessionUnauthorized when requireSession fails',
      () => {
        mockRequireSession.mockReturnValue(
          Effect.fail({
            _tag: 'SessionUnauthorized',
            statusCode: 401,
            message: 'Unauthorized',
            messageKey: 'auth.unauthorized',
          }),
        );

        return withService((svc) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(svc.profile());
            expect(error).toMatchObject({ _tag: 'SessionUnauthorized' });
          }),
        );
      },
    );
  });

  describe('sessionClaims', () => {
    it.effect('returns user_id, session_id, and epoch-seconds timing', () => {
      mockRequireSession.mockReturnValue(Effect.succeed(makeSession()));

      return withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.sessionClaims();
          // createdAt: 2026-03-10T12:00:00Z -> 1773144000
          // expiresAt: 2026-03-17T12:00:00Z -> 1773748800
          expect(result).toEqual({
            user_id: 'user-1',
            session_id: 'session-1',
            issued_at: 1773144000,
            expires_at: 1773748800,
          });
        }),
      );
    });

    it.effect(
      'propagates SessionUnauthorized when requireSession fails',
      () => {
        mockRequireSession.mockReturnValue(
          Effect.fail({
            _tag: 'SessionUnauthorized',
            statusCode: 401,
            message: 'Unauthorized',
            messageKey: 'auth.unauthorized',
          }),
        );

        return withService((svc) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(svc.sessionClaims());
            expect(error).toMatchObject({ _tag: 'SessionUnauthorized' });
          }),
        );
      },
    );

    it.effect('does not call RolesService', () => {
      mockRequireSession.mockReturnValue(Effect.succeed(makeSession()));
      const getPermissionsForUser = vi.fn();

      return withService(
        (svc) =>
          Effect.gen(function* () {
            yield* svc.sessionClaims();
            expect(getPermissionsForUser).not.toHaveBeenCalled();
          }),
        { getPermissionsForUser },
      );
    });
  });
});
