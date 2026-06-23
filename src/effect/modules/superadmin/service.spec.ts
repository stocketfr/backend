import { Effect, Layer } from 'effect';
import {
  DEFAULT_FEATURE_STATES,
  EntitlementSource,
  FeatureKey,
  PlanKey,
} from '@stocket/types/features';
import { BetterAuth, BetterAuthHeaders } from '../../platform/auth/better-auth';
import { FeaturesService } from '../features/service';
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
    findBetterAuthUserByLoweredEmail: vi
      .fn()
      .mockReturnValue(Effect.succeed(null)),
    findTenantById: vi.fn().mockReturnValue(
      Effect.succeed({
        id: '00000000-0000-4000-8000-000000000101',
        name: 'Acme France',
        slug: 'acme',
        primaryHostname: 'acme.localhost:3000',
        createdAt: new Date('2026-06-22T10:00:00.000Z'),
      }),
    ),
    createTenantWithAdmin: vi
      .fn()
      .mockReturnValue(Effect.succeed(createdTenant)),
    updateTenant: vi.fn().mockReturnValue(
      Effect.succeed({
        tenant: {
          id: '00000000-0000-4000-8000-000000000101',
          name: 'Acme Updated',
          slug: 'acme',
          primaryHostname: 'acme.localhost:3000',
          createdAt: new Date('2026-06-22T10:00:00.000Z'),
        },
        overrides: [],
      }),
    ),
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

  const makeFeaturesService = () => ({
    getFeaturesForTenant: vi.fn(() =>
      Effect.succeed({
        tenantId: createdTenant.tenant.id,
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
    ),
    setTenantPlan: vi.fn(() =>
      Effect.succeed({
        tenantId: createdTenant.tenant.id,
        planKey: PlanKey.GROWTH,
        source: EntitlementSource.MANUAL,
        features: {
          [FeatureKey.SMART_IMPORT]: true,
          [FeatureKey.ORDERS]: true,
        },
        overrides: [],
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_by: actor.userId,
      }),
    ),
    setFeatureOverride: vi.fn(() =>
      Effect.succeed({
        tenantId: createdTenant.tenant.id,
        planKey: PlanKey.FREE,
        source: EntitlementSource.SYSTEM,
        features: {
          [FeatureKey.SMART_IMPORT]: true,
          [FeatureKey.ORDERS]: true,
        },
        overrides: [],
        updated_at: null,
        updated_by: null,
      }),
    ),
    clearFeatureOverride: vi.fn(() =>
      Effect.succeed({
        tenantId: createdTenant.tenant.id,
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
    ),
  });

  const makeServiceLayer = ({
    betterAuth,
    featuresService,
    repository,
    usersRepository,
  }: {
    betterAuth: unknown;
    featuresService?: unknown;
    repository: unknown;
    usersRepository: unknown;
  }) =>
    SuperAdminService.DefaultWithoutDependencies.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(BetterAuth, betterAuth as typeof BetterAuth.Service),
          Layer.succeed(
            FeaturesService,
            (featuresService ??
              makeFeaturesService()) as typeof FeaturesService.Service,
          ),
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
      featuresService: makeFeaturesService(),
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
    const welcomeRequest =
      betterAuth.api.requestPasswordReset.mock.calls[0]![0];
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
      featuresService: makeFeaturesService(),
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
  it('updates tenant name and staged feature state atomically through the repository', async () => {
    const betterAuth = makeBetterAuth();
    const repository = makeRepository();
    const usersRepository = makeUsersRepository();
    const featuresService = makeFeaturesService();
    featuresService.getFeaturesForTenant.mockReturnValue(
      Effect.succeed({
        tenantId: createdTenant.tenant.id,
        planKey: PlanKey.FREE,
        source: EntitlementSource.MANUAL,
        features: {
          ...DEFAULT_FEATURE_STATES,
          [FeatureKey.SMART_IMPORT]: true,
        },
        overrides: [],
        updated_at: null,
        updated_by: null,
      }),
    );
    const layer = makeServiceLayer({
      betterAuth,
      featuresService,
      repository,
      usersRepository,
    });

    const features = {
      ...DEFAULT_FEATURE_STATES,
      [FeatureKey.SMART_IMPORT]: true,
    };

    const result = await run(
      Effect.flatMap(SuperAdminService, (service) =>
        service.updateTenant(
          '00000000-0000-4000-8000-000000000101',
          {
            name: ' Acme Updated ',
            features,
          },
          actor,
        ),
      ),
      layer,
    );

    expect(repository.updateTenant).toHaveBeenCalledWith({
      tenantId: '00000000-0000-4000-8000-000000000101',
      name: 'Acme Updated',
      features,
      updatedBy: 'superadmin-1',
    });
    expect(result.features[FeatureKey.SMART_IMPORT]).toBe(true);
    expect(featuresService.getFeaturesForTenant).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000101',
    );

    await waitForCall(repository.recordPlatformAuditEvent);
    expect(repository.recordPlatformAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.update',
        entityId: '00000000-0000-4000-8000-000000000101',
      }),
    );
  });

  it('fails when updating an unknown tenant', async () => {
    const betterAuth = makeBetterAuth();
    const repository = makeRepository();
    repository.updateTenant.mockReturnValue(Effect.succeed(null));
    const usersRepository = makeUsersRepository();
    const layer = makeServiceLayer({
      betterAuth,
      featuresService: makeFeaturesService(),
      repository,
      usersRepository,
    });

    const error = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(SuperAdminService, (service) =>
          service.updateTenant(
            '00000000-0000-4000-8000-000000000999',
            {
              name: 'Missing',
              features: DEFAULT_FEATURE_STATES,
            },
            actor,
          ),
        ),
      ).pipe(Effect.provide(layer)),
    );

    expect(error).toMatchObject({
      _tag: 'TenantNotFound',
      tenantId: '00000000-0000-4000-8000-000000000999',
      statusCode: 404,
    });
  });

  it('delegates tenant feature reads and writes to FeaturesService', async () => {
    const betterAuth = makeBetterAuth();
    const repository = makeRepository();
    const usersRepository = makeUsersRepository();
    const featuresService = makeFeaturesService();
    const layer = makeServiceLayer({
      betterAuth,
      featuresService,
      repository,
      usersRepository,
    });

    const tenantId = createdTenant.tenant.id;

    await run(
      Effect.flatMap(SuperAdminService, (service) =>
        service.getTenantFeatures(tenantId),
      ),
      layer,
    );
    await run(
      Effect.flatMap(SuperAdminService, (service) =>
        service.updateTenantPlan(
          tenantId,
          { planKey: PlanKey.GROWTH },
          actor.userId,
        ),
      ),
      layer,
    );
    await run(
      Effect.flatMap(SuperAdminService, (service) =>
        service.updateTenantFeatureOverride(
          tenantId,
          FeatureKey.SMART_IMPORT,
          { enabled: true, reason: 'Beta tenant', expires_at: null },
          actor.userId,
        ),
      ),
      layer,
    );
    await run(
      Effect.flatMap(SuperAdminService, (service) =>
        service.clearTenantFeatureOverride(tenantId, FeatureKey.SMART_IMPORT),
      ),
      layer,
    );

    expect(featuresService.getFeaturesForTenant).toHaveBeenCalledWith(tenantId);
    expect(featuresService.setTenantPlan).toHaveBeenCalledWith(
      tenantId,
      { planKey: PlanKey.GROWTH },
      actor.userId,
    );
    expect(featuresService.setFeatureOverride).toHaveBeenCalledWith(
      tenantId,
      FeatureKey.SMART_IMPORT,
      { enabled: true, reason: 'Beta tenant', expires_at: null },
      actor.userId,
    );
    expect(featuresService.clearFeatureOverride).toHaveBeenCalledWith(
      tenantId,
      FeatureKey.SMART_IMPORT,
    );
  });
});
