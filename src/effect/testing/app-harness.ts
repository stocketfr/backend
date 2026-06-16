import { HttpApp } from '@effect/platform';
import { NodeFileSystem, NodePath } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { buildHttpApp } from '../http/app';
import { AuditLogsService } from '../modules/audit-logs/service';
import { AreasService } from '../modules/areas/service';
import { AuthService } from '../modules/auth/service';
import { BrandingService } from '../modules/branding/service';
import { CategoriesService } from '../modules/categories/service';
import { ClientsService } from '../modules/clients/service';
import { HealthService } from '../modules/health/service';
import { InventoryService } from '../modules/inventory/service';
import { LocationsService } from '../modules/locations/service';
import { OrdersService } from '../modules/orders/service';
import { PhotosService } from '../modules/photos/service';
import { ProductImportService } from '../modules/products/import/service';
import { ProductsService } from '../modules/products/service';
import { RolesService } from '../modules/roles/service';
import { StockMovementsService } from '../modules/stock-movements/service';
import { SuperAdminService } from '../modules/superadmin/service';
import { SuppliersService } from '../modules/suppliers/service';
import { UsersService } from '../modules/users/service';
import { auditLayer } from '../platform/audit/index';
import { BetterAuthHeaders } from '../platform/auth/better-auth';
import { PermissionProvider } from '../platform/auth/permission-provider';
import { makeTestDrizzleLayer } from '../test/integration-layer';
import {
  makeBetterAuthTestLayer,
  type BetterAuthStubOptions,
} from './better-auth-test';
import { makeEmailTestLayer, type EmailTestHarness } from './email-test';
import { makeInMemoryStorageAdapterLayer } from '../platform/storage';
import { TEST_BETTER_AUTH_HEADERS } from './test-harness';

interface TestHttpAppOptions {
  readonly session?: unknown;
  readonly betterAuthOverrides?: BetterAuthStubOptions['overrides'];
  readonly email?: EmailTestHarness;
}

export const makeTestApplicationLayer = (options: TestHttpAppOptions = {}) => {
  const storage = makeInMemoryStorageAdapterLayer();
  const platformLayer = Layer.mergeAll(
    makeTestDrizzleLayer(),
    makeBetterAuthTestLayer({
      overrides: {
        getSession: async () => options.session ?? null,
        ...options.betterAuthOverrides,
      } as BetterAuthStubOptions['overrides'],
    }),
    Layer.succeed(BetterAuthHeaders, TEST_BETTER_AUTH_HEADERS),
    (options.email ?? makeEmailTestLayer()).layer,
    storage.layer,
  );

  const withPlatform = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
    layer.pipe(Layer.provide(platformLayer));

  const rolesApplicationLayer = withPlatform(RolesService.Default);
  const permissionProviderLayer = Layer.effect(
    PermissionProvider,
    Effect.map(RolesService, ({ getPermissionsForUser }) => ({
      getPermissionsForUser,
    })),
  ).pipe(Layer.provide(rolesApplicationLayer));
  const authApplicationLayer = AuthService.Default.pipe(
    Layer.provide(rolesApplicationLayer),
  );
  const usersApplicationLayer = UsersService.Default.pipe(
    Layer.provide(Layer.mergeAll(platformLayer, rolesApplicationLayer)),
  );
  const superAdminApplicationLayer = SuperAdminService.Default.pipe(
    Layer.provide(platformLayer),
  );

  const foundationalServicesLayer = Layer.mergeAll(
    withPlatform(HealthService.Default),
    withPlatform(AuditLogsService.Default),
    withPlatform(BrandingService.Default),
    withPlatform(LocationsService.Default),
    withPlatform(CategoriesService.Default),
    withPlatform(ClientsService.Default),
    withPlatform(SuppliersService.Default),
    withPlatform(PhotosService.Default),
  );

  const locationsApplicationLayer = withPlatform(LocationsService.Default);
  const categoriesApplicationLayer = withPlatform(CategoriesService.Default);
  const areasApplicationLayer = AreasService.Default.pipe(
    Layer.provide(Layer.mergeAll(platformLayer, locationsApplicationLayer)),
  );
  const clientsApplicationLayer = withPlatform(ClientsService.Default);
  const productsApplicationLayer = ProductsService.Default.pipe(
    Layer.provide(Layer.mergeAll(platformLayer, categoriesApplicationLayer)),
  );
  const productImportApplicationLayer = ProductImportService.Default.pipe(
    Layer.provide(platformLayer),
  );
  const workflowServicesLayer = Layer.mergeAll(
    StockMovementsService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          platformLayer,
          productsApplicationLayer,
          locationsApplicationLayer,
        ),
      ),
    ),
    InventoryService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          platformLayer,
          productsApplicationLayer,
          locationsApplicationLayer,
          areasApplicationLayer,
        ),
      ),
    ),
    OrdersService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          platformLayer,
          clientsApplicationLayer,
          productsApplicationLayer,
        ),
      ),
    ),
  );

  return Layer.mergeAll(
    platformLayer,
    NodeFileSystem.layer,
    NodePath.layer,
    auditLayer.pipe(Layer.provide(platformLayer)),
    foundationalServicesLayer,
    rolesApplicationLayer,
    permissionProviderLayer,
    authApplicationLayer,
    usersApplicationLayer,
    superAdminApplicationLayer,
    areasApplicationLayer,
    productsApplicationLayer,
    productImportApplicationLayer,
    workflowServicesLayer,
  );
};

export const makeTestHttpAppHandler = (options: TestHttpAppOptions = {}) => {
  const applicationLayer = makeTestApplicationLayer(options);

  return HttpApp.toWebHandlerLayerWith(applicationLayer as never, {
    toHandler: () =>
      buildHttpApp.pipe(Effect.provide(applicationLayer)) as never,
  });
};
