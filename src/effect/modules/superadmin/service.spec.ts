import { Effect, Layer } from 'effect';
import { BetterAuth, BetterAuthHeaders } from '../../platform/auth/better-auth';
import { UsersRepository } from '../users/repository';
import { SuperAdminRepository } from './repository';
import { SuperAdminService } from './service';

vi.mock('../../platform/auth/better-auth', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');

  return {
    BetterAuth: Context.GenericTag('@stocket/test/BetterAuth'),
    BetterAuthHeaders: Context.GenericTag('@stocket/test/BetterAuthHeaders'),
    betterAuthLayer: Layer.empty,
  };
});

describe('Effect SuperAdminService', () => {
  const actor = {
    userId: 'superadmin-1',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  };
  const createTenantInput = {
    name: 'Acme France',
    slug: 'Acme',
    admin: {
      name: 'Tenant Admin',
      email: 'ADMIN@EXAMPLE.COM',
      password: 'password123',
    },
  };
  const createdTenant = {
    tenant: {
      id: '00000000-0000-4000-8000-000000000101',
      name: 'Acme France',
      slug: 'acme',
      hostname: 'acme.localhost:3000',
    },
    admin: {
      id: 'tenant-admin-1',
    },
  };

  const makeRepository = () => ({
    tenantSlugExists: vi.fn().mockReturnValue(Effect.succeed(false)),
    tenantHostnameExists: vi.fn().mockReturnValue(Effect.succeed(false)),
    findBetterAuthUserByLoweredEmail: vi.fn().mockReturnValue(
      Effect.succeed(null),
    ),
    createTenantWithAdmin: vi
      .fn()
      .mockReturnValue(Effect.succeed(createdTenant)),
    recordPlatformAuditEvent: vi.fn().mockReturnValue(Effect.void),
  });

  const makeUsersRepository = () => ({
    deleteBetterAuthUser: vi.fn().mockReturnValue(Effect.void),
  });

  const makeBetterAuth = () => ({
    api: {
      createUser: vi.fn().mockResolvedValue({
        user: { id: 'tenant-admin-1' },
      }),
      requestPasswordReset: vi.fn().mockResolvedValue({ status: true }),
    },
  });

  const makeServiceLayer = ({
    betterAuth,
    repository,
    usersRepository,
  }: {
    betterAuth: unknown;
    repository: unknown;
    usersRepository: unknown;
  }) =>
    SuperAdminService.DefaultWithoutDependencies.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(BetterAuth, betterAuth as typeof BetterAuth.Service),
          Layer.succeed(
            SuperAdminRepository,
            repository as typeof SuperAdminRepository.Service,
          ),
          Layer.succeed(
            UsersRepository,
            usersRepository as typeof UsersRepository.Service,
          ),
        ),
      ),
    );

  const requestHeaders = new Headers({
    origin: 'https://localhost:3000',
    'accept-language': 'fr',
  });

  const run = <A, E>(
    effect: Effect.Effect<A, E, SuperAdminService | globalThis.Headers>,
    layer: Layer.Layer<SuperAdminService>,
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provideService(BetterAuthHeaders, requestHeaders),
        Effect.provide(layer),
      ),
    );

  const waitForCall = async (spy: ReturnType<typeof vi.fn>) => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (spy.mock.calls.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it('creates a verified tenant admin and sends a tenant welcome email', async () => {
    const betterAuth = makeBetterAuth();
    const repository = makeRepository();
    const usersRepository = makeUsersRepository();
    const layer = makeServiceLayer({
      betterAuth,
      repository,
      usersRepository,
    });

    const result = await run(
      Effect.flatMap(SuperAdminService, (service) =>
        service.createTenant(createTenantInput, actor),
      ),
      layer,
    );

    expect(betterAuth.api.createUser).toHaveBeenCalledWith({
      body: {
        email: 'admin@example.com',
        name: 'Tenant Admin',
        password: 'password123',
        data: { emailVerified: true },
      },
    });
    expect(repository.createTenantWithAdmin).toHaveBeenCalledWith({
      name: 'Acme France',
      slug: 'acme',
      hostname: 'acme.localhost:3000',
      adminUserId: 'tenant-admin-1',
    });
    expect(result.admin).toEqual({
      id: 'tenant-admin-1',
      email: 'admin@example.com',
      name: 'Tenant Admin',
    });

    await waitForCall(betterAuth.api.requestPasswordReset);
    const welcomeRequest = betterAuth.api.requestPasswordReset.mock.calls[0]![0];
    expect(welcomeRequest.body).toEqual({
      email: 'admin@example.com',
      redirectTo: 'https://acme.localhost:3000/reset-password?flow=welcome',
    });
    expect(welcomeRequest.headers.get('origin')).toBe(
      'https://acme.localhost:3000',
    );
    expect(welcomeRequest.headers.get('accept-language')).toBe('fr');
    expect(welcomeRequest.request.url).toBe(
      'https://acme.localhost:3000/reset-password?flow=welcome',
    );
  });

  it('does not create or email an existing tenant admin user', async () => {
    const betterAuth = makeBetterAuth();
    const repository = makeRepository();
    repository.findBetterAuthUserByLoweredEmail.mockReturnValue(
      Effect.succeed({
        id: 'existing-admin-1',
        email: 'existing@example.com',
        name: 'Existing Admin',
      }),
    );
    const usersRepository = makeUsersRepository();
    const layer = makeServiceLayer({
      betterAuth,
      repository,
      usersRepository,
    });

    const result = await run(
      Effect.flatMap(SuperAdminService, (service) =>
        service.createTenant(createTenantInput, actor),
      ),
      layer,
    );

    expect(betterAuth.api.createUser).not.toHaveBeenCalled();
    expect(betterAuth.api.requestPasswordReset).not.toHaveBeenCalled();
    expect(result.admin).toEqual({
      id: 'existing-admin-1',
      email: 'existing@example.com',
      name: 'Existing Admin',
    });
  });
});
