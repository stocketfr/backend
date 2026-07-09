/**
 * Unit-scope tests for `locationsRouter`.
 *
 * Scope: HTTP boundary only — guard → decode → service-call → respond.
 * Service internals live in `service.spec.ts` / `service.integration.spec.ts`.
 *
 * Canonical coverage per route:
 *   1. Permission guard rejects insufficient role → 403
 *   2. Decode failure on malformed body / params → 400
 *   3. Service success → correct status + payload shape
 *   4. Service tagged error → mapped HTTP status (404, 500, ...)
 *
 * Mutations are `@Auditable`. The audit writer is fire-and-forget, so we
 * verify it's *called* via a spy — we do not couple to whether its
 * downstream effect succeeds.
 */
import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { LocationType } from '@stocket/types/locations';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  LocationNotFound,
  LocationsInfrastructureError,
} from './locations.errors';
import { makeLocationsRouterHarness } from './__fixtures__/router-harness';
import { LocationsService } from './service';

// Replace the service Tag with an empty-layer tag so the harness can wire
// a per-test mock via `Layer.succeed(LocationsService, ...)`.
vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');
  return {
    LocationsService: Context.GenericTag('@stocket/test/LocationsService'),
    locationsLayer: Layer.empty,
  };
});

const LOC_ID = '11111111-1111-4111-8111-111111111111';

const makeLocationResponse = (overrides: Record<string, unknown> = {}) => ({
  id: LOC_ID,
  name: 'Warehouse A',
  type: LocationType.WAREHOUSE,
  address: '123 Main St',
  contact_person: 'Alice',
  phone: '555-0100',
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const writeAll = {
  [Resource.LOCATIONS]: [Permission.READ, Permission.WRITE],
};
const readOnly = {
  [Resource.LOCATIONS]: [Permission.READ],
};

const jsonHeaders = { 'content-type': 'application/json' };

describe('locationsRouter', () => {
  // -------------------------------------------------------------------
  // GET /locations/all
  // -------------------------------------------------------------------
  describe('GET /locations/all', () => {
    it('rejects without LOCATIONS:read permission', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: { findAll: () => Effect.succeed([makeLocationResponse()]) },
        permissions: {},
      });

      const response = await handler(
        new Request('http://localhost/locations/all'),
      );

      expect(response.status).toBe(403);
    });

    it('returns 401 when the session is absent', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: { findAll: () => Effect.succeed([]) },
        permissions: readOnly,
        session: null,
      });

      const response = await handler(
        new Request('http://localhost/locations/all'),
      );

      expect(response.status).toBe(401);
    });

    it('returns the unpaginated location list on success', async () => {
      const findAll = vi.fn(() => Effect.succeed([makeLocationResponse()]));
      const { handler } = makeLocationsRouterHarness({
        service: { findAll },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/locations/all'),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id: LOC_ID, name: 'Warehouse A' });
      expect(findAll).toHaveBeenCalledTimes(1);
    });

    it('maps a service infrastructure failure → 500', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: {
          findAll: () =>
            Effect.fail(
              new LocationsInfrastructureError({
                action: 'findAll',
                messageKey: 'locations.infrastructureError',
              }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/locations/all'),
      );
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // GET /locations (paginated)
  // -------------------------------------------------------------------
  describe('GET /locations', () => {
    const paginatedPayload = {
      data: [makeLocationResponse()],
      meta: { total: 1, page: 1, limit: 20, total_pages: 1 },
    };

    it('rejects without LOCATIONS:read permission', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: { findAllPaginated: () => Effect.succeed(paginatedPayload) },
        permissions: {},
      });

      const response = await handler(new Request('http://localhost/locations'));

      expect(response.status).toBe(403);
    });

    it('returns 400 when the query is malformed', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: { findAllPaginated: () => Effect.succeed(paginatedPayload) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/locations?page=not-a-number'),
      );

      expect(response.status).toBe(400);
    });

    it('returns the paginated payload on success', async () => {
      const findAllPaginated = vi.fn(() => Effect.succeed(paginatedPayload));
      const { handler } = makeLocationsRouterHarness({
        service: { findAllPaginated },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/locations?page=1&limit=20'),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: [{ id: LOC_ID }],
        meta: { total: 1, page: 1 },
      });
      expect(findAllPaginated).toHaveBeenCalledTimes(1);
    });

    it('maps a service infrastructure failure → 500', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: {
          findAllPaginated: () =>
            Effect.fail(
              new LocationsInfrastructureError({
                action: 'findAllPaginated',
                messageKey: 'locations.infrastructureError',
              }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/locations?page=1&limit=20'),
      );
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // GET /locations/:id
  // -------------------------------------------------------------------
  describe('GET /locations/:id', () => {
    it('rejects without LOCATIONS:read permission', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: { findOne: () => Effect.succeed(makeLocationResponse()) },
        permissions: {},
      });

      const response = await handler(
        new Request(`http://localhost/locations/${LOC_ID}`),
      );

      expect(response.status).toBe(403);
    });

    it('returns 400 when the path id is not a UUID', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: { findOne: () => Effect.succeed(makeLocationResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/locations/not-a-uuid'),
      );

      expect(response.status).toBe(400);
    });

    it('returns the location on success', async () => {
      const findOne = vi.fn((id: string) =>
        Effect.succeed(makeLocationResponse({ id })),
      );
      const { handler } = makeLocationsRouterHarness({
        service: { findOne },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/locations/${LOC_ID}`),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: LOC_ID });
      expect(findOne).toHaveBeenCalledWith(LOC_ID);
    });

    it('maps LocationNotFound → 404', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: {
          findOne: (id: string) =>
            Effect.fail(
              new LocationNotFound({ id, messageKey: 'locations.notFound' }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/locations/${LOC_ID}`),
      );

      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // POST /locations
  // -------------------------------------------------------------------
  describe('POST /locations', () => {
    const validBody = { name: 'New Warehouse', type: LocationType.WAREHOUSE };

    it('rejects without LOCATIONS:write permission', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: { create: () => Effect.succeed(makeLocationResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/locations', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );

      expect(response.status).toBe(403);
    });

    it('returns 400 on malformed body', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: { create: () => Effect.succeed(makeLocationResponse()) },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/locations', {
          method: 'POST',
          headers: jsonHeaders,
          // missing required `name`
          body: JSON.stringify({ type: LocationType.WAREHOUSE }),
        }),
      );

      expect(response.status).toBe(400);
    });

    it('returns 201 and writes a CREATE audit on success', async () => {
      const created = makeLocationResponse({ name: 'New Warehouse' });
      const create = vi.fn(() => Effect.succeed(created));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeLocationsRouterHarness({
        service: { create },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request('http://localhost/locations', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        name: 'New Warehouse',
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.LOCATION,
        entityId: LOC_ID,
      });
    });

    it('maps an infrastructure failure → 500 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeLocationsRouterHarness({
        service: {
          create: () =>
            Effect.fail(
              new LocationsInfrastructureError({
                action: 'create',
                messageKey: 'locations.infrastructureError',
              }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request('http://localhost/locations', {
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
  // PUT /locations/:id
  // -------------------------------------------------------------------
  describe('PUT /locations/:id', () => {
    const updateBody = { name: 'Renamed' };

    it('rejects without LOCATIONS:write permission', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: { update: () => Effect.succeed(makeLocationResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/locations/${LOC_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );

      expect(response.status).toBe(403);
    });

    it('returns 400 when the body fails schema decode', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: { update: () => Effect.succeed(makeLocationResponse()) },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/locations/${LOC_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          // `name` must be non-empty if supplied
          body: JSON.stringify({ name: '' }),
        }),
      );

      expect(response.status).toBe(400);
    });

    it('returns 200 and writes an UPDATE audit on success', async () => {
      const updated = makeLocationResponse({ name: 'Renamed' });
      const update = vi.fn(() => Effect.succeed(updated));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeLocationsRouterHarness({
        service: { update },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/locations/${LOC_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ name: 'Renamed' });
      expect(update).toHaveBeenCalledWith(LOC_ID, { name: 'Renamed' });
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.LOCATION,
        entityId: LOC_ID,
      });
    });

    it('maps LocationNotFound → 404 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeLocationsRouterHarness({
        service: {
          update: (id: string) =>
            Effect.fail(
              new LocationNotFound({ id, messageKey: 'locations.notFound' }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/locations/${LOC_ID}`, {
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
  // DELETE /locations/:id
  // -------------------------------------------------------------------
  describe('DELETE /locations/:id', () => {
    it('rejects without LOCATIONS:write permission', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: { delete: () => Effect.void },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/locations/${LOC_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(403);
    });

    it('returns 400 when path id is not a UUID', async () => {
      const { handler } = makeLocationsRouterHarness({
        service: { delete: () => Effect.void },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/locations/bad-id', { method: 'DELETE' }),
      );

      expect(response.status).toBe(400);
    });

    it('returns 200 with a message body and fires a DELETE audit', async () => {
      const del = vi.fn(() => Effect.void);
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeLocationsRouterHarness({
        service: { delete: del },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/locations/${LOC_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toHaveProperty('message');
      expect(del).toHaveBeenCalledWith(LOC_ID);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.LOCATION,
        entityId: LOC_ID,
      });
    });

    it('maps LocationNotFound → 404 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeLocationsRouterHarness({
        service: {
          delete: (id: string) =>
            Effect.fail(
              new LocationNotFound({ id, messageKey: 'locations.notFound' }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/locations/${LOC_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(404);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  // Keep the tag import statically referenced so `LocationsService` usage
  // (harness passes it as Layer tag) isn't lint-flagged as unused.
  it('exposes the LocationsService tag', () => {
    expect(LocationsService).toBeDefined();
  });
});
