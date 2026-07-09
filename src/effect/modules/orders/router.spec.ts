/**
 * Unit-scope tests for `ordersRouter`.
 *
 * Scope: HTTP boundary only — guard → decode → service → respond. Service
 * internals live in `service.spec.ts` / `service.integration.spec.ts`.
 *
 * Canonical coverage per route:
 *   1. Permission guard rejects insufficient role → 403
 *   2. Decode failure on malformed body / params → 400
 *   3. Service success → correct status + payload shape
 *   4. Service tagged error → mapped HTTP status (404 / 400 / 500)
 *
 * Mutations are `@Auditable`. The audit writer is fire-and-forget, so we
 * verify it's *called* via a spy — we do not couple to whether its
 * downstream effect succeeds.
 */
import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { OrderStatus } from '@stocket/types/orders';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  CannotDeleteNonDraftOrder,
  ClientNotFound,
  InvalidOrderStatusTransition,
  OrderNotFound,
  OrdersInfrastructureError,
} from './orders.errors';
import { makeOrdersRouterHarness } from './__fixtures__/router-harness';
import { OrdersService } from './service';

vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');
  return {
    OrdersService: Context.GenericTag('@stocket/test/OrdersService'),
    ordersLayer: Layer.empty,
  };
});

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';

const makeOrderResponse = (overrides: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  order_number: 'ORD-20260101-00001',
  client_id: CLIENT_ID,
  client_name: 'Acme Charters',
  status: OrderStatus.DRAFT,
  delivery_address: '1 Dock Rd',
  delivery_deadline: null,
  yacht_name: null,
  special_instructions: null,
  total_amount: 100,
  assigned_to: null,
  created_by: 'user-1',
  confirmed_at: null,
  shipped_at: null,
  delivered_at: null,
  kanban_task_id: null,
  items: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const writeAll = {
  [Resource.ORDERS]: [Permission.READ, Permission.WRITE],
};
const readOnly = {
  [Resource.ORDERS]: [Permission.READ],
};

const jsonHeaders = { 'content-type': 'application/json' };

const validCreateBody = {
  client_id: CLIENT_ID,
  delivery_address: '1 Dock Rd',
  items: [{ product_id: PRODUCT_ID, quantity: 2, unit_price: 50 }],
};

describe('ordersRouter', () => {
  // -------------------------------------------------------------------
  // GET /orders — paginated list
  // -------------------------------------------------------------------
  describe('GET /orders', () => {
    const paginated = {
      data: [makeOrderResponse()],
      meta: { total: 1, page: 1, limit: 20, total_pages: 1 },
    };

    it('rejects without ORDERS:read permission', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: { findAllPaginated: () => Effect.succeed(paginated) },
        permissions: {},
      });

      const response = await handler(new Request('http://localhost/orders'));
      expect(response.status).toBe(403);
    });

    it('rejects when the Orders feature is disabled', async () => {
      const findAllPaginated = vi.fn(() => Effect.succeed(paginated));
      const { handler } = makeOrdersRouterHarness({
        service: { findAllPaginated },
        permissions: readOnly,
        ordersFeatureEnabled: false,
      });

      const response = await handler(new Request('http://localhost/orders'));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        messageKey: 'features.notEnabled',
      });
      expect(findAllPaginated).not.toHaveBeenCalled();
    });

    it('returns 400 when the query is malformed', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: { findAllPaginated: () => Effect.succeed(paginated) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/orders?page=not-a-number'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the paginated payload on success', async () => {
      const findAllPaginated = vi.fn(() => Effect.succeed(paginated));
      const { handler } = makeOrdersRouterHarness({
        service: { findAllPaginated },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/orders?page=1&limit=20'),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: [{ id: ORDER_ID }],
        meta: { total: 1, page: 1 },
      });
      expect(findAllPaginated).toHaveBeenCalledTimes(1);
    });

    it('maps infrastructure failure → 500', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: {
          findAllPaginated: () =>
            Effect.fail(
              new OrdersInfrastructureError({
                action: 'findAllPaginated',
                messageKey: 'orders.infrastructureError',
              }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(new Request('http://localhost/orders'));
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // GET /orders/:id
  // -------------------------------------------------------------------
  describe('GET /orders/:id', () => {
    it('rejects without ORDERS:read permission', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: { findOne: () => Effect.succeed(makeOrderResponse()) },
        permissions: {},
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}`),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when id is not a UUID', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: { findOne: () => Effect.succeed(makeOrderResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/orders/not-a-uuid'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the order on success', async () => {
      const findOne = vi.fn((id: string) =>
        Effect.succeed(makeOrderResponse({ id })),
      );
      const { handler } = makeOrdersRouterHarness({
        service: { findOne },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}`),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: ORDER_ID });
      expect(findOne).toHaveBeenCalledWith(ORDER_ID);
    });

    it('maps OrderNotFound → 404', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: {
          findOne: (id: string) =>
            Effect.fail(
              new OrderNotFound({ id, messageKey: 'orders.notFound' }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}`),
      );
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // POST /orders — create
  // -------------------------------------------------------------------
  describe('POST /orders', () => {
    it('rejects without ORDERS:write permission', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: { create: () => Effect.succeed(makeOrderResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/orders', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validCreateBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 on malformed body', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: { create: () => Effect.succeed(makeOrderResponse()) },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/orders', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ client_id: CLIENT_ID }), // missing items, delivery_address
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 201 and writes a CREATE audit on success', async () => {
      const created = makeOrderResponse();
      const create = vi.fn(() => Effect.succeed(created));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeOrdersRouterHarness({
        service: { create },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request('http://localhost/orders', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validCreateBody),
        }),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({ id: ORDER_ID });
      expect(create).toHaveBeenCalledTimes(1);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.ORDER,
        entityId: ORDER_ID,
      });
    });

    it('maps ClientNotFound → 400 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeOrdersRouterHarness({
        service: {
          create: () =>
            Effect.fail(
              new ClientNotFound({
                clientId: CLIENT_ID,
                messageKey: 'orders.clientNotFound',
              }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request('http://localhost/orders', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validCreateBody),
        }),
      );

      expect(response.status).toBe(400);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // PUT /orders/:id — update
  // -------------------------------------------------------------------
  describe('PUT /orders/:id', () => {
    const updateBody = { delivery_address: '2 Dock Rd' };

    it('rejects without ORDERS:write permission', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: { update: () => Effect.succeed(makeOrderResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the body fails schema decode', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: { update: () => Effect.succeed(makeOrderResponse()) },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          // assigned_to must be a UUID or null
          body: JSON.stringify({ assigned_to: 'not-a-uuid' }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 and writes an UPDATE audit on success', async () => {
      const updated = makeOrderResponse({ delivery_address: '2 Dock Rd' });
      const update = vi.fn(() => Effect.succeed(updated));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeOrdersRouterHarness({
        service: { update },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        delivery_address: '2 Dock Rd',
      });
      expect(update).toHaveBeenCalledWith(ORDER_ID, {
        delivery_address: '2 Dock Rd',
      });
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.ORDER,
        entityId: ORDER_ID,
      });
    });

    it('maps OrderNotFound → 404 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeOrdersRouterHarness({
        service: {
          update: (id: string) =>
            Effect.fail(
              new OrderNotFound({ id, messageKey: 'orders.notFound' }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );

      expect(response.status).toBe(404);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // PATCH /orders/:id/status — update status
  // -------------------------------------------------------------------
  describe('PATCH /orders/:id/status', () => {
    const statusBody = { status: OrderStatus.CONFIRMED };

    it('rejects without ORDERS:write permission', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: { updateStatus: () => Effect.succeed(makeOrderResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}/status`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(statusBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when status is not a valid literal', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: { updateStatus: () => Effect.succeed(makeOrderResponse()) },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}/status`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ status: 'NOT_A_STATUS' }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 and writes a STATUS_CHANGE audit on success', async () => {
      const updated = makeOrderResponse({ status: OrderStatus.CONFIRMED });
      const updateStatus = vi.fn(() => Effect.succeed(updated));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeOrdersRouterHarness({
        service: { updateStatus },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}/status`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(statusBody),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: OrderStatus.CONFIRMED,
      });
      expect(updateStatus).toHaveBeenCalledWith(ORDER_ID, statusBody);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.STATUS_CHANGE,
        entityType: AuditEntityType.ORDER,
        entityId: ORDER_ID,
      });
    });

    it('maps InvalidOrderStatusTransition → 400 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeOrdersRouterHarness({
        service: {
          updateStatus: () =>
            Effect.fail(
              new InvalidOrderStatusTransition({
                from: OrderStatus.DRAFT,
                to: OrderStatus.SHIPPED,
                messageKey: 'orders.invalidStatusTransition',
                messageArgs: {
                  from: OrderStatus.DRAFT,
                  to: OrderStatus.SHIPPED,
                },
              }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}/status`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ status: OrderStatus.SHIPPED }),
        }),
      );

      expect(response.status).toBe(400);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // DELETE /orders/:id
  // -------------------------------------------------------------------
  describe('DELETE /orders/:id', () => {
    it('rejects without ORDERS:write permission', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: { delete: () => Effect.void },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when id is not a UUID', async () => {
      const { handler } = makeOrdersRouterHarness({
        service: { delete: () => Effect.void },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/orders/bad-id', { method: 'DELETE' }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 with a message body and fires a DELETE audit', async () => {
      const del = vi.fn(() => Effect.void);
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeOrdersRouterHarness({
        service: { delete: del },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toHaveProperty('message');
      expect(del).toHaveBeenCalledWith(ORDER_ID);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.ORDER,
        entityId: ORDER_ID,
      });
    });

    it('maps CannotDeleteNonDraftOrder → 400 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeOrdersRouterHarness({
        service: {
          delete: (id: string) =>
            Effect.fail(
              new CannotDeleteNonDraftOrder({
                orderId: id,
                status: OrderStatus.CONFIRMED,
                messageKey: 'orders.deleteOnlyDraft',
              }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/orders/${ORDER_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(400);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  it('exposes the OrdersService tag', () => {
    expect(OrdersService).toBeDefined();
  });
});
