/**
 * Unit-scope tests for `suppliersRouter`.
 *
 * Covers each route's HTTP boundary: permission guard, body/query/param
 * decode, happy-path service response, and tagged-error → status
 * mapping. Service internals live in `service.spec.ts`.
 */
import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import type { SupplierResponseDto } from '@stocket/types/suppliers';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { SupplierNotFound, SuppliersInfrastructureError } from './suppliers.errors';
import { makeSuppliersRouterHarness } from './__fixtures__/router-harness';
import { SuppliersService } from './service';

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
    SuppliersService: Context.GenericTag('@stocket/test/SuppliersService'),
    suppliersLayer: Layer.empty,
  };
});

const SUPPLIER_ID = '33333333-3333-4333-8333-333333333333';

const makeSupplier = (
  overrides: Partial<SupplierResponseDto> = {},
): SupplierResponseDto => ({
  id: SUPPLIER_ID,
  name: 'Acme Supplies',
  contact_person: null,
  email: null,
  phone: null,
  address: null,
  website: null,
  notes: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const writeAll: Partial<Record<Resource, Permission[]>> = {
  [Resource.SUPPLIERS]: [Permission.READ, Permission.WRITE],
};
const readOnly: Partial<Record<Resource, Permission[]>> = {
  [Resource.SUPPLIERS]: [Permission.READ],
};
const noAccess: Partial<Record<Resource, Permission[]>> = {};
const jsonHeaders = { 'content-type': 'application/json' };

describe('suppliersRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const session = { user: { id: VALID_USER_ID } };
    mockRequireSession.mockReturnValue(Effect.succeed(session));
    mockGetOptionalSession.mockReturnValue(Effect.succeed(session));
  });

  // -------------------------------------------------------------------
  // GET /suppliers (paginated)
  // -------------------------------------------------------------------
  describe('GET /suppliers', () => {
    it('rejects without suppliers:read', async () => {
      const { handler } = makeSuppliersRouterHarness({
        service: {
          findAllPaginated: () =>
            Effect.die('findAllPaginated should not run'),
        },
        permissions: noAccess,
      });

      const response = await handler(new Request('http://localhost/suppliers'));
      expect(response.status).toBe(403);
    });

    it('returns 400 when the query fails to decode', async () => {
      const { handler } = makeSuppliersRouterHarness({
        service: {
          findAllPaginated: () =>
            Effect.die('findAllPaginated should not run'),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/suppliers?page=abc'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the paginated payload on success', async () => {
      const paginated = {
        data: [makeSupplier()],
        total: 1,
        page: 1,
        limit: 20,
        total_pages: 1,
      };
      const findAllPaginated = vi.fn(() => Effect.succeed(paginated));
      const { handler } = makeSuppliersRouterHarness({
        service: { findAllPaginated },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/suppliers?page=1&limit=20'),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: [{ id: SUPPLIER_ID }],
        total: 1,
      });
      expect(findAllPaginated).toHaveBeenCalledTimes(1);
    });

    it('maps service infrastructure failure to 500', async () => {
      const { handler } = makeSuppliersRouterHarness({
        service: {
          findAllPaginated: () => Effect.die('boom'),
        },
        permissions: readOnly,
      });

      const response = await handler(new Request('http://localhost/suppliers'));
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // GET /suppliers/:id
  // -------------------------------------------------------------------
  describe('GET /suppliers/:id', () => {
    it('rejects without suppliers:read', async () => {
      const { handler } = makeSuppliersRouterHarness({
        service: { findOne: () => Effect.succeed(makeSupplier()) },
        permissions: noAccess,
      });
      const response = await handler(
        new Request(`http://localhost/suppliers/${SUPPLIER_ID}`),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the id is not a UUID', async () => {
      const { handler } = makeSuppliersRouterHarness({
        service: {
          findOne: () => Effect.die('findOne should not run'),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/suppliers/not-a-uuid'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the supplier on success', async () => {
      const findOne = vi.fn((id: string) =>
        Effect.succeed(makeSupplier({ id })),
      );
      const { handler } = makeSuppliersRouterHarness({
        service: { findOne },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/suppliers/${SUPPLIER_ID}`),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: SUPPLIER_ID });
      expect(findOne).toHaveBeenCalledWith(SUPPLIER_ID);
    });

    it('maps SupplierNotFound → 404', async () => {
      const { handler } = makeSuppliersRouterHarness({
        service: {
          findOne: (id: string) =>
            Effect.fail(
              new SupplierNotFound({ id, messageKey: 'suppliers.notFound' }),
            ),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/suppliers/${SUPPLIER_ID}`),
      );
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // POST /suppliers
  // -------------------------------------------------------------------
  describe('POST /suppliers', () => {
    const validBody = { name: 'New Supplier' };

    it('rejects without suppliers:write', async () => {
      const { handler } = makeSuppliersRouterHarness({
        service: { create: () => Effect.succeed(makeSupplier()) },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/suppliers', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the body fails to decode', async () => {
      const { handler } = makeSuppliersRouterHarness({
        service: {
          create: () => Effect.die('create should not run'),
        },
        permissions: writeAll,
      });
      const response = await handler(
        new Request('http://localhost/suppliers', {
          method: 'POST',
          headers: jsonHeaders,
          // `name` is required, minLength(1)
          body: JSON.stringify({ name: '' }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 201 and writes audit on success', async () => {
      const created = makeSupplier({ name: 'New Supplier' });
      const create = vi.fn(() => Effect.succeed(created));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeSuppliersRouterHarness({
        service: { create },
        permissions: writeAll,
        auditLog,
      });
      const response = await handler(
        new Request('http://localhost/suppliers', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        id: SUPPLIER_ID,
        name: 'New Supplier',
      });
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.SUPPLIER,
        entityId: SUPPLIER_ID,
      });
    });

    it('maps a service-level failure to 500', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeSuppliersRouterHarness({
        service: {
          create: () =>
            Effect.fail(
              new SuppliersInfrastructureError({
                messageKey: 'suppliers.repositoryFailed',
                action: 'insert',
              }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });
      const response = await handler(
        new Request('http://localhost/suppliers', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(500);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // PUT /suppliers/:id
  // -------------------------------------------------------------------
  describe('PUT /suppliers/:id', () => {
    const updateBody = { name: 'Renamed Supplier' };

    it('rejects without suppliers:write', async () => {
      const { handler } = makeSuppliersRouterHarness({
        service: { update: () => Effect.succeed(makeSupplier()) },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/suppliers/${SUPPLIER_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the body is malformed', async () => {
      const { handler } = makeSuppliersRouterHarness({
        service: {
          update: () => Effect.die('update should not run'),
        },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/suppliers/${SUPPLIER_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          // email is optional but must match EmailSchema when present
          body: JSON.stringify({ email: 'not-an-email' }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 and writes UPDATE audit on success', async () => {
      const updated = makeSupplier({ name: 'Renamed Supplier' });
      const update = vi.fn(() => Effect.succeed(updated));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeSuppliersRouterHarness({
        service: { update },
        permissions: writeAll,
        auditLog,
      });
      const response = await handler(
        new Request(`http://localhost/suppliers/${SUPPLIER_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        name: 'Renamed Supplier',
      });
      expect(update).toHaveBeenCalledWith(SUPPLIER_ID, updateBody);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.SUPPLIER,
        entityId: SUPPLIER_ID,
      });
    });

    it('maps SupplierNotFound → 404 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeSuppliersRouterHarness({
        service: {
          update: (id: string) =>
            Effect.fail(
              new SupplierNotFound({ id, messageKey: 'suppliers.notFound' }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });
      const response = await handler(
        new Request(`http://localhost/suppliers/${SUPPLIER_ID}`, {
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
  // DELETE /suppliers/:id
  // -------------------------------------------------------------------
  describe('DELETE /suppliers/:id', () => {
    it('rejects without suppliers:write', async () => {
      const { handler } = makeSuppliersRouterHarness({
        service: { delete: () => Effect.void },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/suppliers/${SUPPLIER_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the id is not a UUID', async () => {
      const { handler } = makeSuppliersRouterHarness({
        service: {
          delete: () => Effect.die('delete should not run'),
        },
        permissions: writeAll,
      });
      const response = await handler(
        new Request('http://localhost/suppliers/bad-id', {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 with a message envelope and fires DELETE audit', async () => {
      const del = vi.fn(() => Effect.void);
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeSuppliersRouterHarness({
        service: { delete: del },
        permissions: writeAll,
        auditLog,
      });
      const response = await handler(
        new Request(`http://localhost/suppliers/${SUPPLIER_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toHaveProperty('message');
      expect(del).toHaveBeenCalledWith(SUPPLIER_ID);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.SUPPLIER,
        entityId: SUPPLIER_ID,
      });
    });

    it('maps SupplierNotFound → 404 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeSuppliersRouterHarness({
        service: {
          delete: (id: string) =>
            Effect.fail(
              new SupplierNotFound({ id, messageKey: 'suppliers.notFound' }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });
      const response = await handler(
        new Request(`http://localhost/suppliers/${SUPPLIER_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(404);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  it('has SuppliersService tag available', () => {
    expect(SuppliersService).toBeDefined();
  });
});
