import { HttpServerRequest } from '@effect/platform';
import { Effect, Layer } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { DrizzleDatabase } from '../drizzle';
import { PermissionProvider } from '../permission-provider';
import {
  requirePermission,
  requireSuperAdmin,
  PermissionDenied,
  PlatformHostRequired,
  SuperAdminDenied,
  SuperAdminInfrastructureError,
} from '../authorization';

const mockRequireSession = vi.fn();
const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>);
const fail = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(Effect.flip(effect as Effect.Effect<A, E, never>));

vi.mock('../session', async () => {
  const { Effect } = await vi.importActual<typeof import('effect')>('effect');

  return {
    requireSession: Effect.suspend(() => mockRequireSession()),
  };
});

describe('requirePermission', () => {
  const permissionProvider = {
    getPermissionsForUser: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes when the user has the required permission', async () => {
    mockRequireSession.mockReturnValue(
      Effect.succeed({
        user: { id: 'user-1' },
      }),
    );
    permissionProvider.getPermissionsForUser.mockReturnValue(
      Effect.succeed({
        roleNames: ['Admin'],
        permissions: {
          [Resource.ROLES]: [Permission.READ],
        },
      }),
    );

    await expect(
      run(
        requirePermission(Resource.ROLES, Permission.READ).pipe(
          Effect.provide(
            Layer.succeed(PermissionProvider, permissionProvider),
          ),
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it('fails with 403 when the user lacks the permission', async () => {
    mockRequireSession.mockReturnValue(
      Effect.succeed({
        user: { id: 'user-1' },
      }),
    );
    permissionProvider.getPermissionsForUser.mockReturnValue(
      Effect.succeed({
        roleNames: ['Viewer'],
        permissions: {
          [Resource.ROLES]: [Permission.READ],
        },
      }),
    );

    await expect(
      fail(
        requirePermission(Resource.ROLES, Permission.WRITE).pipe(
          Effect.provide(
            Layer.succeed(PermissionProvider, permissionProvider),
          ),
        ),
      ),
    ).resolves.toBeInstanceOf(PermissionDenied);
  });

  it('propagates unauthenticated failures', async () => {
    mockRequireSession.mockReturnValue(
      Effect.fail({
        _tag: 'SessionUnauthorized',
        messageKey: 'auth.unauthorized',
        message: 'Unauthorized',
        statusCode: 401,
      }),
    );

    await expect(
      fail(
        requirePermission(Resource.ROLES, Permission.READ).pipe(
          Effect.provide(
            Layer.succeed(PermissionProvider, permissionProvider),
          ),
        ),
      ),
    ).resolves.toMatchObject({
      _tag: 'SessionUnauthorized',
      statusCode: 401,
    });
  });

  it('propagates provider failures', async () => {
    mockRequireSession.mockReturnValue(
      Effect.succeed({
        user: { id: 'user-1' },
      }),
    );
    permissionProvider.getPermissionsForUser.mockReturnValue(
      Effect.fail({
        _tag: 'RolesInfrastructureError',
        statusCode: 500,
        message: 'error',
        messageKey: 'roles.loadPermissionsFailed',
      }),
    );

    await expect(
      fail(
        requirePermission(Resource.ROLES, Permission.READ).pipe(
          Effect.provide(
            Layer.succeed(PermissionProvider, permissionProvider),
          ),
        ),
      ),
    ).resolves.toMatchObject({
      _tag: 'RolesInfrastructureError',
      statusCode: 500,
    });
  });
});

describe('requireSuperAdmin', () => {
  const makeRequestLayer = (host: string) =>
    Layer.succeed(
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.fromWeb(
        new Request(`http://${host}/api/v1/superadmin/me`, {
          headers: { host },
        }),
      ),
    );

  const makeDbLayer = (rows: unknown[]) =>
    Layer.succeed(DrizzleDatabase, {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(rows)),
          })),
        })),
      })),
    } as unknown as typeof DrizzleDatabase.Service);

  const makeFailingDbLayer = () =>
    Layer.succeed(DrizzleDatabase, {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.reject(new Error('db down'))),
          })),
        })),
      })),
    } as unknown as typeof DrizzleDatabase.Service);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails before DB authorization on a tenant host', async () => {
    mockRequireSession.mockReturnValue(
      Effect.succeed({ user: { id: 'user-1' } }),
    );

    await expect(
      fail(
        requireSuperAdmin.pipe(
          Effect.provide(makeRequestLayer('tenant.stocket.fr')),
          Effect.provide(makeDbLayer([{ user_id: 'user-1' }])),
        ),
      ),
    ).resolves.toBeInstanceOf(PlatformHostRequired);
    expect(mockRequireSession).not.toHaveBeenCalled();
  });

  it('fails with 403 when the session user is not in super_admins', async () => {
    mockRequireSession.mockReturnValue(
      Effect.succeed({ user: { id: 'user-1' } }),
    );

    await expect(
      fail(
        requireSuperAdmin.pipe(
          Effect.provide(
            makeRequestLayer('app.stocket.fr'),
          ),
          Effect.provide(makeDbLayer([])),
        ),
      ),
    ).resolves.toBeInstanceOf(SuperAdminDenied);
  });

  it('maps DB failures to SuperAdminInfrastructureError', async () => {
    mockRequireSession.mockReturnValue(
      Effect.succeed({ user: { id: 'user-1' } }),
    );

    await expect(
      fail(
        requireSuperAdmin.pipe(
          Effect.provide(
            makeRequestLayer('app.stocket.fr'),
          ),
          Effect.provide(makeFailingDbLayer()),
        ),
      ),
    ).resolves.toBeInstanceOf(SuperAdminInfrastructureError);
  });

  it('passes on the platform host when the session user is a superadmin', async () => {
    mockRequireSession.mockReturnValue(
      Effect.succeed({ user: { id: 'user-1' } }),
    );

    await expect(
      run(
        requireSuperAdmin.pipe(
          Effect.provide(
            makeRequestLayer('app.stocket.fr'),
          ),
          Effect.provide(makeDbLayer([{ user_id: 'user-1' }])),
        ),
      ),
    ).resolves.toMatchObject({ user: { id: 'user-1' } });
  });
});
