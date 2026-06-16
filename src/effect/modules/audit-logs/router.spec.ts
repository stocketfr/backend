import { type Context, Effect, Layer } from 'effect';
import { HttpApp, HttpRouter } from '@effect/platform';
import { Permission, Resource } from '@stocket/types/auth';
import {
  AuditAction,
  AuditEntityType,
} from '@stocket/types/audit-logs';
import { respondCause } from '../../platform/http/errors';
import { PermissionProvider } from '../../platform/auth/permission-provider';
import { makeBetterAuthTestLayer } from '../../testing/better-auth-test';
import { auditLogsRouter } from './router';
import { AuditLogNotFound } from './audit-logs.errors';
import { AuditLogsService } from './service';

// Stand-in AuditLogsService tag; the real service requires Drizzle via its
// repository. Router tests only verify the HTTP boundary.
vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');

  return {
    AuditLogsService: Context.GenericTag('@stocket/test/AuditLogsService'),
    auditLogsLayer: Layer.empty,
  };
});

vi.mock('uuid', () => ({
  v4: () => '00000000-0000-4000-8000-000000000000',
  validate: () => true,
}));

const LOG_ID = '10000000-0000-4000-8000-000000000001';
const ENTITY_ID = '10000000-0000-4000-8000-000000000002';
const USER_ID = '20000000-0000-4000-a000-000000000001';

const fakeSession = {
  user: {
    id: USER_ID,
    name: 'Router Tester',
    email: 'router-tester@example.com',
    image: null,
    emailVerified: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  session: {
    id: 'session-router',
    userId: USER_ID,
    token: 'tok',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-02-01T00:00:00.000Z'),
  },
};

const betterAuthLayer = makeBetterAuthTestLayer({
  overrides: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getSession: (async () => fakeSession) as any,
  } as any,
});

const permissionProviderLayer = (
  permissions: Partial<Record<Resource, Permission[]>>,
) =>
  Layer.succeed(PermissionProvider, {
    getPermissionsForUser: () =>
      Effect.succeed({ roleNames: ['Test'], permissions }),
  });

const fullReadPerms: Partial<Record<Resource, Permission[]>> = {
  [Resource.AUDIT_LOGS]: [Permission.READ],
};

const makeHandler = (
  service: Partial<Context.Tag.Service<typeof AuditLogsService>>,
  permissions: Partial<Record<Resource, Permission[]>> = fullReadPerms,
) => {
  const wrappedRouter = auditLogsRouter.pipe(
    HttpRouter.catchAllCause(respondCause),
  );
  const app = Effect.runSync(HttpRouter.toHttpApp(wrappedRouter));

  const envLayer = Layer.mergeAll(
    Layer.succeed(
      AuditLogsService,
      service as Context.Tag.Service<typeof AuditLogsService>,
    ),
    betterAuthLayer,
    permissionProviderLayer(permissions),
  );

  return HttpApp.toWebHandlerLayer(app as any, envLayer as any).handler;
};

const makeAuditLog = () => ({
  id: LOG_ID,
  user_id: USER_ID,
  user_name: 'Router Tester',
  action: AuditAction.CREATE,
  entity_type: AuditEntityType.PRODUCT,
  entity_id: ENTITY_ID,
  changes: null,
  user_agent: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
});

describe('auditLogsRouter', () => {
  describe('GET /audit-logs', () => {
    it('returns 200 with the paginated audit-log list on happy path', async () => {
      const handler = makeHandler({
        query: () =>
          Effect.succeed({
            data: [makeAuditLog()],
            meta: {
              page: 1,
              limit: 20,
              total: 1,
              total_pages: 1,
              has_next: false,
              has_previous: false,
            },
          }),
      });

      const response = await handler(
        new Request('http://localhost/audit-logs'),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        meta: { total: 1 },
        data: [expect.objectContaining({ id: LOG_ID })],
      });
    });

    it('returns 403 when the caller lacks AUDIT_LOGS.READ', async () => {
      const handler = makeHandler(
        { query: () => Effect.die('should not be called') },
        {},
      );

      const response = await handler(
        new Request('http://localhost/audit-logs'),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ statusCode: 403 });
    });

    it('returns 400 when the query params fail schema decode', async () => {
      const handler = makeHandler({
        query: () => Effect.die('should not be called'),
      });

      // `entity_type` must be one of the declared literals; send an invalid
      // value to force a decode failure.
      const response = await handler(
        new Request('http://localhost/audit-logs?entity_type=bogus'),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'http.parseError',
      });
    });
  });

  describe('GET /audit-logs/:id', () => {
    it('returns 200 with the audit log on happy path', async () => {
      const handler = makeHandler({
        findById: () => Effect.succeed(makeAuditLog()),
      });

      const response = await handler(
        new Request(`http://localhost/audit-logs/${LOG_ID}`),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: LOG_ID });
    });

    it('returns 404 when the service fails with AuditLogNotFound', async () => {
      const handler = makeHandler({
        findById: () =>
          Effect.fail(
            new AuditLogNotFound({
              id: LOG_ID,
              messageKey: 'auditLogs.notFound',
            }),
          ),
      });

      const response = await handler(
        new Request(`http://localhost/audit-logs/${LOG_ID}`),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 404,
        messageKey: 'auditLogs.notFound',
      });
    });

    it('returns 400 when the id path param is not a UUID', async () => {
      const handler = makeHandler({
        findById: () => Effect.die('should not be called'),
      });

      const response = await handler(
        new Request('http://localhost/audit-logs/not-a-uuid'),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'http.parseError',
      });
    });

    it('returns 403 when the caller lacks AUDIT_LOGS.READ', async () => {
      const handler = makeHandler(
        { findById: () => Effect.die('should not be called') },
        {},
      );

      const response = await handler(
        new Request(`http://localhost/audit-logs/${LOG_ID}`),
      );

      expect(response.status).toBe(403);
    });
  });

  describe('GET /audit-logs/entity/:entityType/:entityId', () => {
    it('returns 200 with the entity history on happy path', async () => {
      const handler = makeHandler({
        getEntityHistory: () => Effect.succeed([makeAuditLog()]),
      });

      const response = await handler(
        new Request(
          `http://localhost/audit-logs/entity/${AuditEntityType.PRODUCT}/${ENTITY_ID}`,
        ),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body[0]).toMatchObject({ id: LOG_ID });
    });

    it('returns 400 when entityType is not a known literal', async () => {
      const handler = makeHandler({
        getEntityHistory: () => Effect.die('should not be called'),
      });

      const response = await handler(
        new Request(
          `http://localhost/audit-logs/entity/not-an-entity/${ENTITY_ID}`,
        ),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'http.parseError',
      });
    });

    it('returns 403 when the caller lacks AUDIT_LOGS.READ', async () => {
      const handler = makeHandler(
        { getEntityHistory: () => Effect.die('should not be called') },
        {},
      );

      const response = await handler(
        new Request(
          `http://localhost/audit-logs/entity/${AuditEntityType.PRODUCT}/${ENTITY_ID}`,
        ),
      );

      expect(response.status).toBe(403);
    });
  });

  describe('GET /audit-logs/user/:userId', () => {
    it('returns 200 with the user history on happy path', async () => {
      const handler = makeHandler({
        getUserHistory: () => Effect.succeed([makeAuditLog()]),
      });

      const response = await handler(
        new Request(`http://localhost/audit-logs/user/${USER_ID}`),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body[0]).toMatchObject({ id: LOG_ID });
    });

    it('returns 400 when the userId path param is not a UUID', async () => {
      const handler = makeHandler({
        getUserHistory: () => Effect.die('should not be called'),
      });

      const response = await handler(
        new Request('http://localhost/audit-logs/user/not-a-uuid'),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'http.parseError',
      });
    });

    it('returns 403 when the caller lacks AUDIT_LOGS.READ', async () => {
      const handler = makeHandler(
        { getUserHistory: () => Effect.die('should not be called') },
        {},
      );

      const response = await handler(
        new Request(`http://localhost/audit-logs/user/${USER_ID}`),
      );

      expect(response.status).toBe(403);
    });
  });
});
