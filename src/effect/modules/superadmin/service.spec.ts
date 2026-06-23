import { Cause, Effect, Exit, Layer, Option } from 'effect';
import {
  EntitlementSource,
  FeatureKey,
  PlanKey,
} from '@stocket/types/features';
import { BetterAuth, BetterAuthHeaders } from '../../platform/auth/better-auth';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { ProductImportService } from '../products/import/service';
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
    createTenantWithAdmin: vi
      .fn()
      .mockReturnValue(Effect.succeed(createdTenant)),
    createTenantWithAdminRecords: vi
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

  const makeProductImportService = () => ({
    validateCsvContent: vi.fn().mockReturnValue(
      Effect.succeed({
        format: 'normalized-products',
        rows: [],
        validRows: [],
        result: {
          categoriesCreated: 0,
          locationsCreated: 0,
          productsCreated: 0,
          productsUpdated: 0,
          inventoryRecordsCreated: 0,
          inventoryRecordsUpdated: 0,
          rowsSkipped: 0,
          errors: [],
        },
      }),
    ),
    importFromCsvContent: vi.fn(),
  });

  const makeDrizzle = () => ({
    transaction: vi.fn(),
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
    db = makeDrizzle(),
    productImportService = makeProductImportService(),
    featuresService,
    repository,
    usersRepository,
  }: {
    betterAuth: unknown;
    db?: unknown;
    productImportService?: unknown;
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
            (featuresService ?? makeFeaturesService()) as typeof FeaturesService.Service,
          ),
          Layer.succeed(
            SuperAdminRepository,
            repository as typeof SuperAdminRepository.Service,
          ),
          Layer.succeed(DrizzleDatabase, db as typeof DrizzleDatabase.Service),
          Layer.succeed(
            ProductImportService,
            productImportService as typeof ProductImportService.Service,
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

  it('rejects an invalid tenant import file before creating the tenant admin', async () => {
    const betterAuth = makeBetterAuth();
    const repository = makeRepository();
    const usersRepository = makeUsersRepository();
    const productImportService = makeProductImportService();
    productImportService.validateCsvContent.mockReturnValue(
      Effect.succeed({
        format: 'normalized-products',
        rows: [],
        validRows: [],
        result: {
          categoriesCreated: 0,
          locationsCreated: 0,
          productsCreated: 0,
          productsUpdated: 0,
          inventoryRecordsCreated: 0,
          inventoryRecordsUpdated: 0,
          rowsSkipped: 1,
          errors: [
            { row: 2, error: 'Cannot import product without sku and name' },
          ],
        },
      }),
    );
    const layer = makeServiceLayer({
      betterAuth,
      productImportService,
      repository,
      usersRepository,
    });

    const exit = await Effect.runPromiseExit(
      Effect.flatMap(SuperAdminService, (service) =>
        service.createTenant(createTenantInput, actor, {
          importFile: {
            filename: 'products.csv',
            content: 'sku,name,category_path\n,Missing SKU,Food\n',
          },
        }),
      ).pipe(
        Effect.provideService(BetterAuthHeaders, requestHeaders),
        Effect.provide(layer),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error('Expected tenant import validation to fail');
    }
    const failure = Cause.failureOption(exit.cause);
    expect(Option.isSome(failure)).toBe(true);
    if (Option.isNone(failure)) {
      throw new Error('Expected tenant import validation failure');
    }
    expect(failure.value).toMatchObject({
      _tag: 'SuperAdminTenantImportInvalid',
      messageKey: 'superadmin.tenantImportInvalid',
    });

    expect(betterAuth.api.createUser).not.toHaveBeenCalled();
    expect(repository.createTenantWithAdmin).not.toHaveBeenCalled();
    expect(repository.createTenantWithAdminRecords).not.toHaveBeenCalled();
    expect(productImportService.importFromCsvContent).not.toHaveBeenCalled();
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
