import { Effect, Layer } from 'effect';
import { BetterAuth, BetterAuthHeaders } from '../../platform/auth/better-auth';
import { CurrentRequestContext } from '../../platform/http/request-context';
import { RolesService } from '../roles/service';
import { UsersRepository } from './repository';
import { UsersService } from './service';

vi.mock('../../platform/auth/better-auth', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');

  return {
    BetterAuth: Context.GenericTag('@stocket/test/BetterAuth'),
    BetterAuthHeaders: Context.GenericTag('@stocket/test/BetterAuthHeaders'),
    betterAuthLayer: Layer.empty,
  };
});

describe('Effect UsersService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const requestContext = {
    requestId: '00000000-0000-4000-8000-000000000099',
    path: '/api/v1/users',
    method: 'GET' as const,
    ip: null,
    locale: 'en' as const,
    tenantId,
  };

  const betterAuthUser = {
    id: 'user-1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    image: null,
    banned: false,
    banReason: null,
    banExpires: null,
    createdAt: '2026-03-01T00:00:00.000Z',
  };

  const makeBaseRepository = () => ({
    validateRoleIds: vi.fn().mockReturnValue(Effect.void),
    findRoleAssignments: vi.fn().mockReturnValue(Effect.succeed([])),
    findUserRoles: vi.fn().mockReturnValue(Effect.succeed([])),
    createTenantMembership: vi.fn().mockReturnValue(Effect.void),
    replaceUserRoles: vi.fn().mockReturnValue(Effect.void),
    listTenantUsers: vi.fn().mockReturnValue(
      Effect.succeed({
        users: [],
        total: 0,
      }),
    ),
    findBetterAuthUser: vi.fn().mockReturnValue(Effect.succeed(betterAuthUser)),
    deleteBetterAuthUser: vi.fn().mockReturnValue(Effect.void),
    banBetterAuthUser: vi.fn().mockReturnValue(Effect.void),
    unbanBetterAuthUser: vi.fn().mockReturnValue(Effect.void),
    deleteBetterAuthSessions: vi.fn().mockReturnValue(Effect.void),
    deleteUserRoles: vi.fn().mockReturnValue(Effect.void),
    deleteTenantMembership: vi.fn().mockReturnValue(Effect.void),
    hasTenantMembership: vi.fn().mockReturnValue(Effect.succeed(true)),
    hasTenantMemberships: vi.fn().mockReturnValue(Effect.succeed(false)),
  });

  const makeService = async ({
    betterAuth,
    usersRepository,
    rolesService,
  }: {
    betterAuth: unknown;
    usersRepository: unknown;
    rolesService: unknown;
  }) =>
    Effect.runPromise(
      UsersService.pipe(
        Effect.provide(
          UsersService.DefaultWithoutDependencies.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  BetterAuth,
                  betterAuth as typeof BetterAuth.Service,
                ),
                Layer.succeed(
                  UsersRepository,
                  usersRepository as typeof UsersRepository.Service,
                ),
                Layer.succeed(
                  RolesService,
                  rolesService as typeof RolesService.Service,
                ),
              ),
            ),
          ),
        ),
      ),
    );

  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
  const fail = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.runPromise(Effect.flip(effect));
  const requestHeaders = new Headers({ origin: 'https://app.stocket.test' });
  const withTenantContext = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(CurrentRequestContext, requestContext),
      Effect.provideService(BetterAuthHeaders, requestHeaders),
    );
  const waitForCall = async (spy: ReturnType<typeof vi.fn>) => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (spy.mock.calls.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it('creates a tenant member and keeps Better Auth role at the default user level', async () => {
    const createdUser = {
      ...betterAuthUser,
      id: 'user-2',
      name: 'New Admin',
      email: 'new-admin@example.com',
    };
    const betterAuth = {
      api: {
        createUser: vi.fn().mockResolvedValue({ user: createdUser }),
        requestPasswordReset: vi.fn().mockResolvedValue({ status: true }),
      },
    };
    const usersRepository = makeBaseRepository();
    usersRepository.findUserRoles.mockReturnValue(
      Effect.succeed([{ role: { name: 'Admin' } }]),
    );
    const rolesService = {
      clearCacheForUser: vi.fn().mockReturnValue(Effect.void),
    };
    const service = await makeService({
      betterAuth,
      usersRepository,
      rolesService,
    });

    const result = await run(
      withTenantContext(
        service.createUser({
          name: 'New Admin',
          email: 'new-admin@example.com',
          password: 'password123',
          roles: ['role-1'],
        }),
      ),
    );

    expect(betterAuth.api.createUser).toHaveBeenCalledWith({
      body: {
        email: 'new-admin@example.com',
        name: 'New Admin',
        password: 'password123',
        data: { emailVerified: true },
      },
    });
    expect(usersRepository.createTenantMembership).toHaveBeenCalledWith(
      'user-2',
      tenantId,
    );
    expect(usersRepository.replaceUserRoles).toHaveBeenCalledWith(
      'user-2',
      ['role-1'],
      tenantId,
    );
    expect(result.roles).toEqual(['Admin']);

    await waitForCall(betterAuth.api.requestPasswordReset);
    expect(betterAuth.api.requestPasswordReset).toHaveBeenCalledWith({
      body: {
        email: 'new-admin@example.com',
        redirectTo: 'https://app.stocket.test/reset-password?flow=welcome',
      },
      headers: requestHeaders,
      request: expect.any(Request),
    });
  });

  it('still creates the user when the welcome email request fails', async () => {
    const betterAuth = {
      api: {
        createUser: vi.fn().mockResolvedValue({
          user: { ...betterAuthUser, id: 'user-3' },
        }),
        requestPasswordReset: vi
          .fn()
          .mockRejectedValue(new Error('resend is down')),
      },
    };
    const usersRepository = makeBaseRepository();
    const rolesService = {
      clearCacheForUser: vi.fn().mockReturnValue(Effect.void),
    };
    const service = await makeService({
      betterAuth,
      usersRepository,
      rolesService,
    });

    const result = await run(
      withTenantContext(
        service.createUser({
          name: 'New User',
          email: 'new-user@example.com',
          password: 'password123',
          roles: ['role-1'],
        }),
      ),
    );

    expect(result.id).toBe('user-3');
    await waitForCall(betterAuth.api.requestPasswordReset);
    expect(usersRepository.deleteBetterAuthUser).not.toHaveBeenCalled();
  });

  it('deletes the auth user directly when local tenant setup fails after create', async () => {
    const betterAuth = {
      api: {
        createUser: vi.fn().mockResolvedValue({
          user: { ...betterAuthUser, id: 'user-2' },
        }),
      },
    };
    const usersRepository = makeBaseRepository();
    usersRepository.createTenantMembership.mockReturnValue(
      Effect.fail(new Error('membership insert failed')),
    );
    const rolesService = {
      clearCacheForUser: vi.fn().mockReturnValue(Effect.void),
    };
    const service = await makeService({
      betterAuth,
      usersRepository,
      rolesService,
    });

    await expect(
      run(
        withTenantContext(
          service.createUser({
            name: 'New User',
            email: 'new-user@example.com',
            password: 'password123',
            roles: ['role-1'],
          }),
        ),
      ),
    ).rejects.toThrow('membership insert failed');

    expect(usersRepository.deleteBetterAuthUser).toHaveBeenCalledWith('user-2');
  });

  it('paginates tenant users before merging roles', async () => {
    const betterAuth = { api: { createUser: vi.fn() } };
    const usersRepository = makeBaseRepository();
    usersRepository.listTenantUsers.mockReturnValue(
      Effect.succeed({ users: [betterAuthUser], total: 50 }),
    );
    usersRepository.findRoleAssignments.mockReturnValue(
      Effect.succeed([{ user_id: 'user-1', role: { name: 'Admin' } }]),
    );
    const service = await makeService({
      betterAuth,
      usersRepository,
      rolesService: { clearCacheForUser: vi.fn().mockReturnValue(Effect.void) },
    });

    const result = await run(
      withTenantContext(service.listUsers({ page: 2, limit: 1 })),
    );

    expect(result.total).toBe(50);
    expect(result.total_pages).toBe(50);
    expect(result.data[0]!.roles).toEqual(['Admin']);
    expect(usersRepository.listTenantUsers).toHaveBeenCalledWith({
      tenantId,
      offset: 1,
      limit: 1,
      search: undefined,
      role: undefined,
    });
  });

  it('gets a single tenant user with roles from internal storage', async () => {
    const usersRepository = makeBaseRepository();
    usersRepository.findUserRoles.mockReturnValue(
      Effect.succeed([{ role: { name: 'Admin' } }]),
    );
    const service = await makeService({
      betterAuth: { api: { createUser: vi.fn() } },
      usersRepository,
      rolesService: { clearCacheForUser: vi.fn().mockReturnValue(Effect.void) },
    });

    const result = await run(withTenantContext(service.getUser('user-1')));

    expect(usersRepository.findBetterAuthUser).toHaveBeenCalledWith('user-1');
    expect(result.roles).toEqual(['Admin']);
  });

  it('returns UserNotFound without loading the auth user when getUser targets a non-member', async () => {
    const usersRepository = makeBaseRepository();
    usersRepository.hasTenantMembership.mockReturnValue(Effect.succeed(false));
    const service = await makeService({
      betterAuth: { api: { createUser: vi.fn() } },
      usersRepository,
      rolesService: { clearCacheForUser: vi.fn().mockReturnValue(Effect.void) },
    });

    const error = await fail(withTenantContext(service.getUser('user-1')));

    expect(error._tag).toBe('UserNotFound');
    expect(usersRepository.findBetterAuthUser).not.toHaveBeenCalled();
  });

  it('updates tenant roles without syncing Better Auth global admin role', async () => {
    const usersRepository = makeBaseRepository();
    usersRepository.findUserRoles.mockReturnValue(
      Effect.succeed([{ role: { name: 'Admin' } }]),
    );
    const rolesService = {
      clearCacheForUser: vi.fn().mockReturnValue(Effect.void),
    };
    const service = await makeService({
      betterAuth: { api: { createUser: vi.fn() } },
      usersRepository,
      rolesService,
    });

    await run(withTenantContext(service.updateRoles('user-1', ['role-1'])));

    expect(usersRepository.replaceUserRoles).toHaveBeenCalledWith(
      'user-1',
      ['role-1'],
      tenantId,
    );
    expect(rolesService.clearCacheForUser).toHaveBeenCalledWith('user-1');
  });

  it('bans, unbans, and revokes sessions through internal repository paths', async () => {
    const usersRepository = makeBaseRepository();
    const service = await makeService({
      betterAuth: { api: { createUser: vi.fn() } },
      usersRepository,
      rolesService: { clearCacheForUser: vi.fn().mockReturnValue(Effect.void) },
    });

    await run(
      withTenantContext(
        service.banUser('user-1', {
          reason: 'abuse',
          expiresAt: '2026-04-01T00:00:00.000Z',
        }),
      ),
    );
    await run(withTenantContext(service.unbanUser('user-1')));
    await run(withTenantContext(service.revokeSessions('user-1')));

    expect(usersRepository.banBetterAuthUser).toHaveBeenCalledWith('user-1', {
      reason: 'abuse',
      expiresAt: '2026-04-01T00:00:00.000Z',
    });
    expect(usersRepository.unbanBetterAuthUser).toHaveBeenCalledWith('user-1');
    expect(usersRepository.deleteBetterAuthSessions).toHaveBeenCalledWith(
      'user-1',
    );
  });

  it('checks tenant membership before mutating auth state', async () => {
    const usersRepository = makeBaseRepository();
    usersRepository.hasTenantMembership.mockReturnValue(Effect.succeed(false));
    const service = await makeService({
      betterAuth: { api: { createUser: vi.fn() } },
      usersRepository,
      rolesService: { clearCacheForUser: vi.fn().mockReturnValue(Effect.void) },
    });

    await expect(
      fail(
        withTenantContext(
          service.banUser('user-1', {
            reason: 'abuse',
          }),
        ),
      ),
    ).resolves.toMatchObject({ _tag: 'UserNotFound' });
    await expect(
      fail(withTenantContext(service.unbanUser('user-1'))),
    ).resolves.toMatchObject({ _tag: 'UserNotFound' });
    await expect(
      fail(withTenantContext(service.revokeSessions('user-1'))),
    ).resolves.toMatchObject({ _tag: 'UserNotFound' });
    await expect(
      fail(withTenantContext(service.deleteUser('user-1'))),
    ).resolves.toMatchObject({ _tag: 'UserNotFound' });

    expect(usersRepository.findBetterAuthUser).not.toHaveBeenCalled();
    expect(usersRepository.banBetterAuthUser).not.toHaveBeenCalled();
    expect(usersRepository.unbanBetterAuthUser).not.toHaveBeenCalled();
    expect(usersRepository.deleteBetterAuthSessions).not.toHaveBeenCalled();
    expect(usersRepository.deleteBetterAuthUser).not.toHaveBeenCalled();
  });
});
