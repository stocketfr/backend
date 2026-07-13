/**
 * Unit-scope tests for `stockMovementsRouter`.
 *
 * Covers guard → decode → service-success → service-error for each
 * route. Service internals live in `service.spec.ts`.
 *
 * Note: `POST /stock-movements` calls `requireSession` (to pick up
 * `userId` for the movement) in addition to `requirePermission`.
 * We cover both unauthenticated (→ 401) and unauthorized (→ 403)
 * cases below.
 */
import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { ErrorCode } from '@stocket/types/common';
import { StockMovementReason } from '@stocket/types/stock-movements';
import type { StockMovementResponseDto } from '@stocket/types/stock-movements';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  InvalidStockMovementProduct,
  StockMovementLocationNotFound,
  StockMovementNotFound,
  StockMovementProductNotFound,
} from './stock-movements.errors';
import { makeStockMovementsRouterHarness } from './__fixtures__/router-harness';
import { StockMovementsService } from './service';

const VALID_USER_ID = '00000000-0000-4000-a000-000000000001';
const mockRequireSession = vi.fn();
const mockGetOptionalSession = vi.fn();

vi.mock('../../platform/http/session', async () => {
  const { Effect } = await vi.importActual<typeof import('effect')>('effect');
  return {
    requireSession: Effect.suspend(() => mockRequireSession()),
    getOptionalSession: Effect.suspend(() => mockGetOptionalSession()),
  };
});

vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');

  return {
    StockMovementsService: Context.GenericTag(
      '@stocket/test/StockMovementsService',
    ),
    stockMovementsLayer: Layer.empty,
  };
});

const MOVEMENT_ID = '44444444-4444-4444-8444-444444444444';
const PRODUCT_ID = '55555555-5555-4555-8555-555555555555';
const LOCATION_ID = '66666666-6666-4666-8666-666666666666';

const makeMovement = (
  overrides: Partial<StockMovementResponseDto> = {},
): StockMovementResponseDto =>
  ({
    id: MOVEMENT_ID,
    product_id: PRODUCT_ID,
    product: { id: PRODUCT_ID, name: 'Widget', sku: 'WDGT-1' },
    from_location_id: null,
    from_location: null,
    to_location_id: LOCATION_ID,
    to_location: { id: LOCATION_ID, name: 'Warehouse A' },
    quantity: 10,
    reason: StockMovementReason.PURCHASE_RECEIVE,
    order_id: null,
    reference_number: null,
    cost_per_unit: null,
    user_id: VALID_USER_ID,
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as StockMovementResponseDto;

const writeAll: Partial<Record<Resource, Permission[]>> = {
  [Resource.STOCK_MOVEMENTS]: [Permission.READ, Permission.WRITE],
};
const readOnly: Partial<Record<Resource, Permission[]>> = {
  [Resource.STOCK_MOVEMENTS]: [Permission.READ],
};
const noAccess: Partial<Record<Resource, Permission[]>> = {};
const jsonHeaders = { 'content-type': 'application/json' };

describe('stockMovementsRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const session = { user: { id: VALID_USER_ID } };
    mockRequireSession.mockReturnValue(Effect.succeed(session));
    mockGetOptionalSession.mockReturnValue(Effect.succeed(session));
  });

  // -------------------------------------------------------------------
  // GET /stock-movements (paginated)
  // -------------------------------------------------------------------
  describe('GET /stock-movements', () => {
    it('rejects without stock_movements:read', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: {
          findAllPaginated: () => Effect.die('should not run'),
        },
        permissions: noAccess,
      });

      const response = await handler(
        new Request('http://localhost/stock-movements'),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the query is malformed', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: {
          findAllPaginated: () => Effect.die('should not run'),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/stock-movements?page=NaN'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the paginated payload on success', async () => {
      const paginated = {
        data: [makeMovement()],
        total: 1,
        page: 1,
        limit: 20,
        total_pages: 1,
      };
      const findAllPaginated = vi.fn(() => Effect.succeed(paginated));
      const { handler } = makeStockMovementsRouterHarness({
        service: { findAllPaginated },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/stock-movements?page=1&limit=20'),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: [{ id: MOVEMENT_ID }],
        total: 1,
      });
      expect(findAllPaginated).toHaveBeenCalledTimes(1);
    });

    it('maps service infrastructure failure to 500', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: {
          findAllPaginated: () => Effect.die('boom'),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/stock-movements'),
      );
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // GET /stock-movements/product/:productId
  // -------------------------------------------------------------------
  describe('GET /stock-movements/product/:productId', () => {
    it('rejects without stock_movements:read', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: { findByProduct: () => Effect.succeed([]) },
        permissions: noAccess,
      });
      const response = await handler(
        new Request(`http://localhost/stock-movements/product/${PRODUCT_ID}`),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when productId is not a UUID', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: {
          findByProduct: () => Effect.die('should not run'),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/stock-movements/product/not-a-uuid'),
      );
      expect(response.status).toBe(400);
    });

    it('returns movements for the product on success', async () => {
      const findByProduct = vi.fn(() => Effect.succeed([makeMovement()]));
      const { handler } = makeStockMovementsRouterHarness({
        service: { findByProduct },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/stock-movements/product/${PRODUCT_ID}`),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toHaveLength(1);
      expect(findByProduct).toHaveBeenCalledWith(PRODUCT_ID);
    });

    it('maps StockMovementProductNotFound → 404', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: {
          findByProduct: (id: string) =>
            Effect.fail(
              new StockMovementProductNotFound({
                productId: id,
                messageKey: 'stockMovements.productNotFound',
              }),
            ),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/stock-movements/product/${PRODUCT_ID}`),
      );
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // GET /stock-movements/location/:locationId
  // -------------------------------------------------------------------
  describe('GET /stock-movements/location/:locationId', () => {
    it('rejects without stock_movements:read', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: { findByLocation: () => Effect.succeed([]) },
        permissions: noAccess,
      });
      const response = await handler(
        new Request(`http://localhost/stock-movements/location/${LOCATION_ID}`),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when locationId is not a UUID', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: {
          findByLocation: () => Effect.die('should not run'),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/stock-movements/location/bad-id'),
      );
      expect(response.status).toBe(400);
    });

    it('returns movements for the location on success', async () => {
      const findByLocation = vi.fn(() => Effect.succeed([makeMovement()]));
      const { handler } = makeStockMovementsRouterHarness({
        service: { findByLocation },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/stock-movements/location/${LOCATION_ID}`),
      );
      expect(response.status).toBe(200);
      expect(findByLocation).toHaveBeenCalledWith(LOCATION_ID);
    });

    it('maps StockMovementLocationNotFound → 404', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: {
          findByLocation: (id: string) =>
            Effect.fail(
              new StockMovementLocationNotFound({
                locationId: id,
                messageKey: 'stockMovements.locationNotFound',
              }),
            ),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/stock-movements/location/${LOCATION_ID}`),
      );
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // GET /stock-movements/:id
  // -------------------------------------------------------------------
  describe('GET /stock-movements/:id', () => {
    it('rejects without stock_movements:read', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: { findOne: () => Effect.succeed(makeMovement()) },
        permissions: noAccess,
      });
      const response = await handler(
        new Request(`http://localhost/stock-movements/${MOVEMENT_ID}`),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the id is not a UUID', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: { findOne: () => Effect.die('should not run') },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/stock-movements/not-a-uuid'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the movement on success', async () => {
      const findOne = vi.fn((id: string) =>
        Effect.succeed(
          makeMovement({ id } as Partial<StockMovementResponseDto>),
        ),
      );
      const { handler } = makeStockMovementsRouterHarness({
        service: { findOne },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/stock-movements/${MOVEMENT_ID}`),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: MOVEMENT_ID });
      expect(findOne).toHaveBeenCalledWith(MOVEMENT_ID);
    });

    it('maps StockMovementNotFound → 404', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: {
          findOne: (id: string) =>
            Effect.fail(
              new StockMovementNotFound({
                id,
                messageKey: 'stockMovements.notFound',
              }),
            ),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/stock-movements/${MOVEMENT_ID}`),
      );
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // POST /stock-movements
  // -------------------------------------------------------------------
  describe('POST /stock-movements', () => {
    const validBody = {
      product_id: PRODUCT_ID,
      to_location_id: LOCATION_ID,
      quantity: 5,
      reason: StockMovementReason.PURCHASE_RECEIVE,
    };

    it('rejects without stock_movements:write', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: { create: () => Effect.succeed(makeMovement()) },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/stock-movements', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the body fails to decode', async () => {
      const { handler } = makeStockMovementsRouterHarness({
        service: { create: () => Effect.die('should not run') },
        permissions: writeAll,
      });
      const response = await handler(
        new Request('http://localhost/stock-movements', {
          method: 'POST',
          headers: jsonHeaders,
          // quantity must be int >= 1
          body: JSON.stringify({
            product_id: PRODUCT_ID,
            quantity: 0,
            reason: StockMovementReason.PURCHASE_RECEIVE,
          }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 201, echoes the created movement, and writes CREATE audit', async () => {
      const created = makeMovement();
      const create = vi.fn((_dto: unknown, _userId: string) =>
        Effect.succeed(created),
      );
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeStockMovementsRouterHarness({
        service: { create },
        permissions: writeAll,
        auditLog,
      });
      const response = await handler(
        new Request('http://localhost/stock-movements', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        id: MOVEMENT_ID,
        product_id: PRODUCT_ID,
      });
      expect(create).toHaveBeenCalledTimes(1);
      // second arg to create() is the session user id
      expect(create.mock.calls[0]?.[1]).toBe(VALID_USER_ID);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.STOCK_MOVEMENT,
        entityId: MOVEMENT_ID,
      });
    });

    it('maps InvalidStockMovementProduct → 400 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeStockMovementsRouterHarness({
        service: {
          create: () =>
            Effect.fail(
              new InvalidStockMovementProduct({
                productId: PRODUCT_ID,
                messageKey: 'stockMovements.productNotFound',
              }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });
      const response = await handler(
        new Request('http://localhost/stock-movements', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(400);
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('returns 401 when the session is missing', async () => {
      mockRequireSession.mockReturnValueOnce(
        Effect.fail({
          _tag: 'SessionUnauthorized',
          statusCode: 401,
          messageKey: 'auth.unauthorized',
          message: 'Unauthorized',
        }),
      );
      const { handler } = makeStockMovementsRouterHarness({
        service: { create: () => Effect.die('should not run') },
        permissions: writeAll,
      });
      const response = await handler(
        new Request('http://localhost/stock-movements', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
      });
    });
  });

  it('has StockMovementsService tag available', () => {
    expect(StockMovementsService).toBeDefined();
  });
});
