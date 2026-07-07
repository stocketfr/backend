import { Effect, Layer } from 'effect';
import {
  EntitlementSource,
  FeatureKey,
  PlanKey,
} from '@stocket/types/features';
import { BetterAuth, BetterAuthHeaders } from '../../platform/auth/better-auth';
import { FeaturesService } from '../features/service';
import { ProductImportService } from '../products/import/service';
import { UsersRepository } from '../users/repository';
import { SuperAdminRepository } from './repository';
import { TenantNotFound } from './superadmin.errors';
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
    deleteTenant: vi.fn().mockReturnValue(
      Effect.succeed({
        id: createdTenant.tenant.id,
        name: createdTenant.tenant.name,
        slug: createdTenant.tenant.slug,
        primaryHostname: createdTenant.tenant.hostname,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
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
    invalidateTenant: vi.fn(() => Effect.void),
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

  const makeProductImportService = () => ({
    previewCsvContent: vi.fn(() =>
      Effect.succeed({
        format: 'normalized-products' as const,
        totalRows: 0,
        itemRows: 0,
        folderRows: 0,
        importableRows: 0,
        missingRequiredRows: 0,
        duplicateSkuConflicts: [],
        categoryMappings: [],
        supplierMappings: [],
        locationMappings: [],
        inventoryPreviews: [],
        warnings: [],
      }),
    ),
    importFromCsvContent: vi.fn(() =>
      Effect.succeed({
        categoriesCreated: 0,
        locationsCreated: 0,
        productsCreated: 0,
        inventoryRecordsCreated: 0,
        rowsSkipped: 0,
        errors: [],
      }),
    ),
    proposeImportPlan: vi.fn(() =>
      Effect.succeed({
        format: 'normalized-products' as const,
        confidence: 1,
        productIdentity: {
          sourceColumn: 'sku',
          conflictPolicy: 'reject' as const,
        },
        categoryMappings: [],
        supplierMappings: [],
        locationMappings: [],
        warnings: [],
      }),
    ),
  });

  const makeServiceLayer = ({
    betterAuth,
    featuresService,
    productImportService,
    repository,
    usersRepository,
  }: {
    betterAuth: unknown;
    featuresService?: unknown;
    productImportService?: unknown;
    repository: unknown;
    usersRepository: unknown;
  }) =>
    SuperAdminService.DefaultWithoutDependencies.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(BetterAuth, betterAuth as typeof BetterAuth.Service),
          Layer.succeed(
            FeaturesService,
            (featuresService ?? makeFeaturesService()) as typeof FeaturesService.Service,
          ),
          Layer.succeed(
            SuperAdminRepository,
            repository as typeof SuperAdminRepository.Service,
          ),
          Layer.succeed(
            ProductImportService,
            (productImportService ??
              makeProductImportService()) as typeof ProductImportService.Service,
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

  it('deletes a tenant, invalidates feature cache, and records platform audit', async () => {
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
        service.deleteTenant(tenantId, actor),
      ),
      layer,
    );

    expect(repository.deleteTenant).toHaveBeenCalledWith(tenantId);
    expect(featuresService.invalidateTenant).toHaveBeenCalledWith(tenantId);

    await waitForCall(repository.recordPlatformAuditEvent);
    expect(repository.recordPlatformAuditEvent).toHaveBeenCalledWith({
      actorUserId: actor.userId,
      action: 'tenant.delete',
      entityType: 'tenant',
      entityId: tenantId,
      metadata: {
        name: createdTenant.tenant.name,
        slug: createdTenant.tenant.slug,
        primaryHostname: createdTenant.tenant.hostname,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  });

  it('fails with TenantNotFound when deleting an unknown tenant', async () => {
    const betterAuth = makeBetterAuth();
    const repository = makeRepository();
    repository.deleteTenant.mockReturnValue(Effect.succeed(null));
    const usersRepository = makeUsersRepository();
    const featuresService = makeFeaturesService();
    const layer = makeServiceLayer({
      betterAuth,
      featuresService,
      repository,
      usersRepository,
    });

    const tenantId = createdTenant.tenant.id;
    const result = await Effect.runPromise(
      Effect.flatMap(SuperAdminService, (service) =>
        service.deleteTenant(tenantId, actor),
      ).pipe(
        Effect.either,
        Effect.provideService(BetterAuthHeaders, requestHeaders),
        Effect.provide(layer),
      ),
    );

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(TenantNotFound);
    }
    expect(featuresService.invalidateTenant).not.toHaveBeenCalled();
    expect(repository.recordPlatformAuditEvent).not.toHaveBeenCalled();
  });
});
