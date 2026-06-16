/**
 * Router tests for the `/clients` HTTP boundary.
 *
 * Scope: guard -> decode -> respond. The service is replaced with a
 * `vi.mock('./service', ...)` tag so these stay unit-scope (no DB, no real
 * layer graph). Per-test platform dependencies — `requireSession`,
 * `PermissionProvider`, `AuditLogWriter` — are stubbed via `vi.mock` +
 * layer-succeed so we exercise the router wiring without booting the
 * application layer.
 *
 * Canonical reference: `modules/auth/router.spec.ts`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { type Context, Effect, Layer } from 'effect';
import { HttpApp, HttpRouter } from '@effect/platform';
import { Permission, Resource } from '@stocket/types/auth';
import { respondCause } from '../../platform/http/errors';
import { PermissionProvider } from '../../platform/auth/permission-provider';
import { AuditLogWriter } from '../../platform/audit/index';
import { clientsRouter } from './router';
import { ClientsService } from './service';
import { ClientNotFound } from './clients.errors';

// Service tag is replaced with a GenericTag so router tests can swap the
// implementation via `Layer.succeed(ClientsService, mock)` without pulling
// in the repository or Drizzle layers.
vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');
  return {
    ClientsService: Context.GenericTag('@stocket/test/ClientsService'),
    clientsLayer: Layer.empty,
  };
});

// `requireSession` is the only piece of `session.ts` the router path hits
// (via `requirePermission`). Stubbed here with a mutable ref so individual
// tests can assert unauthenticated scenarios.
const mockRequireSession = vi.fn();
vi.mock('../../platform/http/session', async () => {
  const { Effect } = await vi.importActual<typeof import('effect')>('effect');
  return {
    requireSession: Effect.suspend(() => mockRequireSession()),
    getOptionalSession: Effect.succeed(null),
  };
});

vi.mock('uuid', () => ({
  v4: () => '00000000-0000-4000-8000-000000000000',
  validate: () => true,
}));

const TEST_CLIENT_ID = '00000000-0000-4000-a000-000000000001';

const makeClientDto = (overrides: Record<string, any> = {}) => ({
  id: TEST_CLIENT_ID,
  company_name: 'Acme Corp',
  contact_person: 'John Doe',
  email: 'john@acme.com',
  yacht_name: null,
  phone: null,
  billing_address: null,
  default_delivery_address: null,
  account_status: 'ACTIVE',
  payment_terms: null,
  credit_limit: null,
  notes: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

// Granular permission builder — keeps the default permissive so tests can
// override just the resource/permission pair they want to deny.
const makePermissionProviderLayer = (
  permissions: Partial<Record<Resource, Permission[]>> = {
    [Resource.CLIENTS]: [Permission.READ, Permission.WRITE],
  },
) =>
  Layer.succeed(
    PermissionProvider,
    {
      getPermissionsForUser: () =>
        Effect.succeed({ roleNames: ['Admin'], permissions }),
    } as any,
  );

// Audit writer stub — fire-and-forget, tests don't assert on the side channel.
const auditLogWriterLayer = Layer.succeed(AuditLogWriter, {
  log: () => Effect.void,
});

interface HandlerOptions {
  readonly service: Partial<Context.Tag.Service<typeof ClientsService>>;
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
}

const makeHandler = ({ service, permissions }: HandlerOptions) => {
  // Apply the shared top-level cause-to-response translation, same as the
  // real app in `http/app.ts`, so decode/guard failures emerge as proper
  // HTTP envelopes instead of 500s.
  const router = clientsRouter.pipe(HttpRouter.catchAllCause(respondCause));
  const app = Effect.runSync(HttpRouter.toHttpApp(router));

  const combined = Layer.mergeAll(
    Layer.succeed(ClientsService, service as any) as any,
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

describe('clientsRouter', () => {
  describe('GET /clients', () => {
    it('returns paginated clients on success', async () => {
      const handler = makeHandler({
        service: {
          findAllPaginated: () =>
            Effect.succeed({
              data: [makeClientDto()],
              meta: { total: 1, page: 1, limit: 20, total_pages: 1 },
            }),
        } as any,
      });

      const response = await handler(new Request('http://localhost/clients'));
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(TEST_CLIENT_ID);
      expect(body.meta.total).toBe(1);
    });

    it('returns 403 when the caller lacks clients:read', async () => {
      const handler = makeHandler({
        service: {
          findAllPaginated: () => Effect.die('should not be called'),
        } as any,
        permissions: {}, // no CLIENTS permissions
      });

      const response = await handler(new Request('http://localhost/clients'));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 403,
      });
    });

    it('returns 400 when the query string fails to decode', async () => {
      const handler = makeHandler({
        service: {
          findAllPaginated: () => Effect.die('should not be called'),
        } as any,
      });

      // `page` is constrained to a positive integer via PageSchema — a
      // negative value trips decode before the service is invoked.
      const response = await handler(
        new Request('http://localhost/clients?page=-5'),
      );
      expect(response.status).toBe(400);
    });
  });

  describe('GET /clients/:id', () => {
    it('returns 404 when the service reports ClientNotFound', async () => {
      const handler = makeHandler({
        service: {
          findOne: (id: string) =>
            Effect.fail(
              new ClientNotFound({ id, messageKey: 'clients.notFound' }),
            ),
        } as any,
      });

      const response = await handler(
        new Request(`http://localhost/clients/${TEST_CLIENT_ID}`),
      );
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 404,
        messageKey: 'clients.notFound',
      });
    });

    it('returns 400 when the path id is not a UUID', async () => {
      const handler = makeHandler({
        service: {
          findOne: () => Effect.die('should not be called'),
        } as any,
      });

      const response = await handler(
        new Request('http://localhost/clients/not-a-uuid'),
      );
      expect(response.status).toBe(400);
    });
  });

  describe('POST /clients', () => {
    it('returns 201 with the created client body', async () => {
      const handler = makeHandler({
        service: {
          create: () =>
            Effect.succeed(
              makeClientDto({ id: TEST_CLIENT_ID, email: 'new@example.com' }),
            ),
        } as any,
      });

      const response = await handler(
        new Request('http://localhost/clients', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            company_name: 'Acme Corp',
            contact_person: 'John Doe',
            email: 'new@example.com',
          }),
        }),
      );
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        id: TEST_CLIENT_ID,
        email: 'new@example.com',
      });
    });

    it('returns 400 when the request body is malformed', async () => {
      const handler = makeHandler({
        service: { create: () => Effect.die('should not be called') } as any,
      });

      const response = await handler(
        new Request('http://localhost/clients', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contact_person: 'Missing company' }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 403 when the caller lacks clients:write', async () => {
      const handler = makeHandler({
        service: { create: () => Effect.die('should not be called') } as any,
        permissions: { [Resource.CLIENTS]: [Permission.READ] },
      });

      const response = await handler(
        new Request('http://localhost/clients', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            company_name: 'Acme Corp',
            contact_person: 'John Doe',
            email: 'john@acme.com',
          }),
        }),
      );
      expect(response.status).toBe(403);
    });
  });

  describe('PUT /clients/:id', () => {
    it('returns the updated dto on success', async () => {
      const handler = makeHandler({
        service: {
          update: (id: string) =>
            Effect.succeed(makeClientDto({ id, contact_person: 'Jane' })),
        } as any,
      });

      const response = await handler(
        new Request(`http://localhost/clients/${TEST_CLIENT_ID}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contact_person: 'Jane' }),
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: TEST_CLIENT_ID,
        contact_person: 'Jane',
      });
    });

    it('returns 404 when the client cannot be found', async () => {
      const handler = makeHandler({
        service: {
          update: (id: string) =>
            Effect.fail(
              new ClientNotFound({ id, messageKey: 'clients.notFound' }),
            ),
        } as any,
      });

      const response = await handler(
        new Request(`http://localhost/clients/${TEST_CLIENT_ID}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contact_person: 'Jane' }),
        }),
      );
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /clients/:id', () => {
    it('returns a message envelope on success', async () => {
      const handler = makeHandler({
        service: {
          delete: () => Effect.void,
        } as any,
      });

      const response = await handler(
        new Request(`http://localhost/clients/${TEST_CLIENT_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        messageKey: 'clients.deleted',
      });
    });

    it('returns 403 when the caller lacks clients:write', async () => {
      const handler = makeHandler({
        service: { delete: () => Effect.die('should not be called') } as any,
        permissions: { [Resource.CLIENTS]: [Permission.READ] },
      });

      const response = await handler(
        new Request(`http://localhost/clients/${TEST_CLIENT_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(403);
    });
  });
});
