/**
 * Router tests for the `/inventory` HTTP boundary.
 *
 * Scope: guard -> decode -> respond. Nine routes live in `inventoryRouter`;
 * this spec picks the representative 4-test template per route family
 * (list, product lookup, create, adjust) rather than four tests for each
 * of the nine handlers, which would be wall-to-wall repetition. The
 * remaining routes (`/all`, `/location/:id`, `/summary`, PUT, DELETE) get
 * targeted coverage for their unique failure modes.
 *
 * Canonical reference: `modules/auth/router.spec.ts`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { type Context, Effect, Layer } from 'effect';
import { HttpApp, HttpRouter } from '@effect/platform';
import { Permission, Resource } from '@stocket/types/auth';
import { ErrorCode } from '@stocket/types/common';
import { respondCause } from '../../platform/http/errors';
import { PermissionProvider } from '../../platform/auth/permission-provider';
import { AuditLogWriter } from '../../platform/audit/index';
import { inventoryRouter } from './router';
import { InventoryService } from './service';
import {
  InventoryNotFound,
  InventoryQuantityAdjustmentFailed,
} from './inventory.errors';

// Replace the InventoryService tag so router tests can swap the
// implementation without pulling in Drizzle / ProductsService / etc.
vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');
  return {
    InventoryService: Context.GenericTag('@stocket/test/InventoryService'),
    inventoryLayer: Layer.empty,
  };
});

// `requireSession` is the only piece of `session.ts` the router path hits
// (via `requirePermission`).
const mockRequireSession = vi.fn();
vi.mock('../../platform/http/session', async () => {
  const { Effect } = await vi.importActual<typeof import('effect')>('effect');
  return {
    requireSession: Effect.suspend(() => mockRequireSession()),
    getOptionalSession: Effect.succeed(null),
  };
});

vi.mock('uuid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('uuid')>();
  return {
    ...actual,
    v4: () => '00000000-0000-4000-8000-000000000000',
  };
});

const TEST_INVENTORY_ID = '00000000-0000-4000-b000-000000000001';
const TEST_PRODUCT_ID = '00000000-0000-4000-b000-000000000002';
const TEST_LOCATION_ID = '00000000-0000-4000-b000-000000000003';

const makeInventoryDto = (overrides: Record<string, any> = {}) => ({
  id: TEST_INVENTORY_ID,
  product_id: TEST_PRODUCT_ID,
  product: null,
  location_id: TEST_LOCATION_ID,
  location: null,
  area_id: null,
  area: null,
  quantity: 25,
  batchNumber: 'BATCH-1',
  expiry_date: null,
  cost_per_unit: null,
  received_date: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

const makePermissionProviderLayer = (
  permissions: Partial<Record<Resource, Permission[]>> = {
    [Resource.INVENTORY]: [Permission.READ, Permission.WRITE],
  },
) =>
  Layer.succeed(PermissionProvider, {
    getPermissionsForUser: () =>
      Effect.succeed({ roleNames: ['Admin'], permissions }),
  } as any);

const auditLogWriterLayer = Layer.succeed(AuditLogWriter, {
  log: () => Effect.void,
});

interface HandlerOptions {
  readonly service: Partial<Context.Tag.Service<typeof InventoryService>>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
}

const makeHandler = ({ service, permissions }: HandlerOptions) => {
  const router = inventoryRouter.pipe(HttpRouter.catchAllCause(respondCause));
  const app = Effect.runSync(HttpRouter.toHttpApp(router));
  const combined = Layer.mergeAll(
    Layer.succeed(InventoryService, service as any) as any,
    makePermissionProviderLayer(permissions),
    auditLogWriterLayer,
  );
  return HttpApp.toWebHandlerLayer(app as any, combined as any).handler;
};

beforeEach(() => {
  mockRequireSession.mockReturnValue(
    Effect.succeed({ user: { id: 'user-1' } }),
  );
});

describe('inventoryRouter', () => {
  describe('GET /inventory (list)', () => {
    it('returns placement paths with inventory-only read permission', async () => {
      const handler = makeHandler({
        service: {
          findAllPaginated: () =>
            Effect.succeed({
              data: [
                makeInventoryDto({
                  area_id: '00000000-0000-4000-b000-000000000004',
                  area: {
                    id: '00000000-0000-4000-b000-000000000004',
                    name: 'Shelf 3',
                    code: '',
                    path: 'Bay E / Shelf 3',
                  },
                }),
              ],
              meta: { total: 1, page: 1, limit: 20, total_pages: 1 },
            }),
        } as any,
        permissions: {
          [Resource.INVENTORY]: [Permission.READ],
        },
      });

      const response = await handler(new Request('http://localhost/inventory'));
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(TEST_INVENTORY_ID);
      expect(body.data[0].area.path).toBe('Bay E / Shelf 3');
    });

    it('returns 403 when the caller lacks inventory:read', async () => {
      const handler = makeHandler({
        service: {
          findAllPaginated: () => Effect.die('should not be called'),
        } as any,
        permissions: {},
      });

      const response = await handler(new Request('http://localhost/inventory'));
      expect(response.status).toBe(403);
    });

    it('returns 400 when the query string fails to decode', async () => {
      const handler = makeHandler({
        service: {
          findAllPaginated: () => Effect.die('should not be called'),
        } as any,
      });

      const response = await handler(
        // `min_quantity` is parsed with NumberFromString + nonNegative —
        // "abc" is neither a number nor decodable as one.
        new Request('http://localhost/inventory?min_quantity=abc'),
      );
      expect(response.status).toBe(400);
    });
  });

  describe('GET /inventory/product/:productId', () => {
    it('returns the inventory list for the product', async () => {
      const handler = makeHandler({
        service: {
          findByProduct: () => Effect.succeed([makeInventoryDto()]),
        } as any,
      });

      const response = await handler(
        new Request(`http://localhost/inventory/product/${TEST_PRODUCT_ID}`),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toHaveLength(1);
      expect(body[0].product_id).toBe(TEST_PRODUCT_ID);
    });

    it('returns 400 when productId is not a UUID', async () => {
      const handler = makeHandler({
        service: {
          findByProduct: () => Effect.die('should not be called'),
        } as any,
      });

      const response = await handler(
        new Request('http://localhost/inventory/product/not-a-uuid'),
      );
      expect(response.status).toBe(400);
    });
  });

  describe('GET /inventory/summary', () => {
    it('returns the inventory summary when the caller can read inventory', async () => {
      const handler = makeHandler({
        service: {
          findSummary: () =>
            Effect.succeed({
              low_stock_count: 2,
              expiring_soon_count: 1,
            }),
        } as any,
      });

      const response = await handler(
        new Request('http://localhost/inventory/summary'),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        low_stock_count: 2,
        expiring_soon_count: 1,
      });
    });

    it('returns 403 before loading the summary when the caller lacks inventory:read', async () => {
      const findSummary = vi.fn(() => Effect.die('should not be called'));
      const handler = makeHandler({
        service: { findSummary } as any,
        permissions: {},
      });

      const response = await handler(
        new Request('http://localhost/inventory/summary'),
      );

      expect(response.status).toBe(403);
      expect(findSummary).not.toHaveBeenCalled();
    });
  });

  describe('GET /inventory/:id', () => {
    it('returns 404 when the service reports InventoryNotFound', async () => {
      const handler = makeHandler({
        service: {
          findOne: (id: string) =>
            Effect.fail(
              new InventoryNotFound({ id, messageKey: 'inventory.notFound' }),
            ),
        } as any,
      });

      const response = await handler(
        new Request(`http://localhost/inventory/${TEST_INVENTORY_ID}`),
      );
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 404,
        messageKey: 'inventory.notFound',
      });
    });
  });

  describe('POST /inventory', () => {
    const validCreateBody = {
      product_id: TEST_PRODUCT_ID,
      location_id: TEST_LOCATION_ID,
      quantity: 10,
    };

    it('returns 201 with the created inventory body', async () => {
      const handler = makeHandler({
        service: {
          create: () => Effect.succeed(makeInventoryDto()),
        } as any,
      });

      const response = await handler(
        new Request('http://localhost/inventory', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validCreateBody),
        }),
      );
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        id: TEST_INVENTORY_ID,
        quantity: 25,
      });
    });

    it('returns 403 when the caller lacks inventory:write', async () => {
      const handler = makeHandler({
        service: { create: () => Effect.die('should not be called') } as any,
        permissions: { [Resource.INVENTORY]: [Permission.READ] },
      });

      const response = await handler(
        new Request('http://localhost/inventory', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validCreateBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the body is missing required fields', async () => {
      const handler = makeHandler({
        service: { create: () => Effect.die('should not be called') } as any,
      });

      const response = await handler(
        new Request('http://localhost/inventory', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quantity: 10 }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 when quantity is negative', async () => {
      const handler = makeHandler({
        service: { create: () => Effect.die('should not be called') } as any,
      });

      const response = await handler(
        new Request('http://localhost/inventory', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...validCreateBody, quantity: -1 }),
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /inventory/:id/adjust', () => {
    it('returns the adjusted inventory on success', async () => {
      const handler = makeHandler({
        service: {
          adjustQuantity: (id: string) =>
            Effect.succeed(makeInventoryDto({ id, quantity: 30 })),
        } as any,
      });

      const response = await handler(
        new Request(`http://localhost/inventory/${TEST_INVENTORY_ID}/adjust`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ adjustment: 5 }),
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: TEST_INVENTORY_ID,
        quantity: 30,
      });
    });

    it('returns 400 when the adjustment fails downstream', async () => {
      const handler = makeHandler({
        service: {
          adjustQuantity: (id: string) =>
            Effect.fail(
              new InventoryQuantityAdjustmentFailed({
                id,
                adjustment: -50,
                messageKey: 'inventory.quantityAdjustmentNegative',
              }),
            ),
        } as any,
      });

      const response = await handler(
        new Request(`http://localhost/inventory/${TEST_INVENTORY_ID}/adjust`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ adjustment: -50 }),
        }),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        code: ErrorCode.INVENTORY_NEGATIVE_QUANTITY,
        messageKey: 'inventory.quantityAdjustmentNegative',
      });
    });

    it('returns 400 when the body omits adjustment', async () => {
      const handler = makeHandler({
        service: {
          adjustQuantity: () => Effect.die('should not be called'),
        } as any,
      });

      const response = await handler(
        new Request(`http://localhost/inventory/${TEST_INVENTORY_ID}/adjust`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /inventory/:id', () => {
    it('returns a localized message envelope on success', async () => {
      const handler = makeHandler({
        service: {
          delete: () => Effect.void,
        } as any,
      });

      const response = await handler(
        new Request(`http://localhost/inventory/${TEST_INVENTORY_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        messageKey: 'inventory.deleted',
      });
    });

    it('returns 403 when the caller lacks inventory:write', async () => {
      const handler = makeHandler({
        service: { delete: () => Effect.die('should not be called') } as any,
        permissions: { [Resource.INVENTORY]: [Permission.READ] },
      });

      const response = await handler(
        new Request(`http://localhost/inventory/${TEST_INVENTORY_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(403);
    });
  });
});
