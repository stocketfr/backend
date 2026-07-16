import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { authRouter } from './auth/router';
import { rolesRouter } from './roles/router';
import { usersRouter } from './users/router';
import { auditLogsRouter } from './audit-logs/router';
import { brandingRouter } from './branding/router';
import { locationsRouter } from './locations/router';
import { categoriesRouter } from './categories/router';
import { areasRouter } from './areas/router';
import { clientsRouter } from './clients/router';
import { suppliersRouter } from './suppliers/router';
import { productsRouter } from './products/router';
import { productPhotosRouter, photosRouter } from './photos/router';
import { notificationsRouter } from './notifications/router';
import { tasksRouter } from './tasks/router';
import { stockMovementsRouter } from './stock-movements/router';
import { inventoryRouter } from './inventory/router';
import { ordersRouter } from './orders/router';
import { platformRouter } from './platform/router';
import { superAdminRouter } from './superadmin/router';
import { e2eRouter } from './e2e/router';

export const moduleCounterparts = [
  'health',
  'auth',
  'roles',
  'users',
  'audit-logs',
  'branding',
  'locations',
  'categories',
  'areas',
  'clients',
  'features',
  'suppliers',
  'products',
  'photos',
  'stock-movements',
  'inventory',
  'orders',
  'platform',
  'superadmin',
  'notifications',
  'tasks',
  'e2e',
  'mcp',
] as const;

const migrationRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/_migration',
    HttpServerResponse.unsafeJson({
      runtime: 'effect-node',
      modules: moduleCounterparts,
    }),
  ),
);

export const apiRouter = HttpRouter.concatAll(
  migrationRouter,
  authRouter,
  rolesRouter,
  usersRouter,
  auditLogsRouter,
  brandingRouter,
  locationsRouter,
  categoriesRouter,
  areasRouter,
  clientsRouter,
  suppliersRouter,
  productsRouter,
  productPhotosRouter,
  photosRouter,
  notificationsRouter,
  tasksRouter,
  stockMovementsRouter,
  inventoryRouter,
  ordersRouter,
  platformRouter,
  superAdminRouter,
  e2eRouter,
).pipe(HttpRouter.prefixAll('/api/v1'));
