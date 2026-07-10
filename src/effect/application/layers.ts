import { HttpServer } from '@effect/platform';
import type { ServeError } from '@effect/platform/HttpServerError';
import {
  NodeFileSystem,
  NodeHttpServer,
  NodePath,
} from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { createServer } from 'node:http';
import { buildHttpApp } from '../http/app';
import { AuditLogsService } from '../modules/audit-logs/service';
import { AreasService } from '../modules/areas/service';
import { AuthService } from '../modules/auth/service';
import { BrandingService } from '../modules/branding/service';
import { CategoriesService } from '../modules/categories/service';
import { ClientsService } from '../modules/clients/service';
import { FeaturesService } from '../modules/features/service';
import { HealthService } from '../modules/health/service';
import { InventoryService } from '../modules/inventory/service';
import { LocationsService } from '../modules/locations/service';
import { NotificationsService } from '../modules/notifications/service';
import { OrdersService } from '../modules/orders/service';
import { PhotosService } from '../modules/photos/service';
import { ProductImportService } from '../modules/products/import/service';
import { ProductsService } from '../modules/products/service';
import type { RolesInfrastructureError } from '../modules/roles/roles.errors';
import { RolesService } from '../modules/roles/service';
import { StockMovementsService } from '../modules/stock-movements/service';
import { SuperAdminService } from '../modules/superadmin/service';
import { SuppliersService } from '../modules/suppliers/service';
import { TasksService } from '../modules/tasks/service';
import { UsersService } from '../modules/users/service';
import { betterAuthLayer } from '../platform/auth/better-auth';
import { PermissionProvider } from '../platform/auth/permission-provider';
import { AppConfig } from '../platform/config/app-config';
import {
  type DrizzleInitializationError,
  drizzleLayer,
} from '../platform/db/drizzle';
import { TracingLive } from '../platform/observability/tracing';
import {
  type StorageConfigurationError,
  storageLayer,
} from '../platform/storage';
import {
  APPLICATION_NODE_ENVS,
  isApplicationNodeEnv,
  parseApplicationPort,
  type ApplicationNodeEnv,
} from './environment';
import { makeStartupLayer } from './startup';

export {
  APPLICATION_NODE_ENVS,
  isApplicationNodeEnv,
  parseApplicationPort,
  type ApplicationNodeEnv,
};

export type ApplicationLayerError =
  | RolesInfrastructureError
  | DrizzleInitializationError
  | StorageConfigurationError;
export type ApplicationRuntimeError = ApplicationLayerError | ServeError;

export interface ApplicationLayerOptions {
  readonly nodeEnv: ApplicationNodeEnv;
  readonly runBetterAuthMigrations: boolean;
}

export const platformLayer = Layer.mergeAll(
  AppConfig.Default,
  drizzleLayer,
  betterAuthLayer,
  storageLayer,
);

const withPlatform = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  layer.pipe(Layer.provide(platformLayer));

export const makeHttpServerLayer = (port: number) =>
  Layer.unwrapEffect(
    buildHttpApp.pipe(
      Effect.map((app) =>
        HttpServer.serve(app).pipe(
          Layer.provide(NodeHttpServer.layer(createServer, { port })),
        ),
      ),
    ),
  );

export const makeApplicationLayer = (options: ApplicationLayerOptions) => {
  const rolesApplicationLayer = withPlatform(RolesService.Default);
  const featuresApplicationLayer = withPlatform(FeaturesService.Default);
  const permissionProviderLayer = Layer.effect(
    PermissionProvider,
    Effect.map(RolesService, ({ getPermissionsForUser }) => ({
      getPermissionsForUser,
    })),
  ).pipe(Layer.provide(rolesApplicationLayer));
  const authApplicationLayer = AuthService.DefaultWithoutDependencies.pipe(
    Layer.provide(
      Layer.mergeAll(rolesApplicationLayer, featuresApplicationLayer),
    ),
  );
  const usersApplicationLayer = UsersService.Default.pipe(
    Layer.provide(Layer.mergeAll(platformLayer, rolesApplicationLayer)),
  );
  const superAdminApplicationLayer = SuperAdminService.Default.pipe(
    Layer.provide(Layer.mergeAll(platformLayer, featuresApplicationLayer)),
  );

  const notificationsApplicationLayer = withPlatform(
    NotificationsService.Default,
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
    withPlatform(TasksService.Default),
    notificationsApplicationLayer,
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

  const startupLayer = makeStartupLayer(options).pipe(
    Layer.provide(
      Layer.mergeAll(
        platformLayer,
        rolesApplicationLayer,
        notificationsApplicationLayer,
      ),
    ),
  );

  return Layer.mergeAll(
    platformLayer,
    NodeFileSystem.layer,
    NodePath.layer,
    TracingLive,
    startupLayer,
    featuresApplicationLayer,
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
