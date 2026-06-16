import { type Context, Effect, Layer } from 'effect';
import { HttpApp, HttpRouter } from '@effect/platform';
import { Permission, Resource } from '@stocket/types/auth';
import { respondCause } from '../../platform/http/errors';
import { PermissionProvider } from '../../platform/auth/permission-provider';
import { AuditLogWriter } from '../../platform/audit/index';
import { makeBetterAuthTestLayer } from '../../testing/better-auth-test';
import { areasRouter } from './router';
import {
  AreaCircularReference,
  AreaLocationNotFound,
  AreaNotFound,
} from './areas.errors';
import { AreasService } from './service';

// Stand-in AreasService tag + layer; the real service requires Drizzle and
// LocationsService. Router tests only verify the HTTP boundary.
vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');

  return {
    AreasService: Context.GenericTag('@stocket/test/AreasService'),
    areasLayer: Layer.empty,
  };
});

vi.mock('uuid', () => ({
  v4: () => '00000000-0000-4000-8000-000000000000',
  validate: () => true,
}));

const AREA_ID = '10000000-0000-4000-8000-000000000001';
const LOCATION_ID = '10000000-0000-4000-8000-000000000002';
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

const auditLayer = Layer.succeed(AuditLogWriter, {
  log: () => Effect.void,
});

const fullPermissions: Partial<Record<Resource, Permission[]>> = {
  [Resource.LOCATIONS]: [Permission.READ, Permission.WRITE],
};

const makeHandler = (
  service: Partial<Context.Tag.Service<typeof AreasService>>,
  permissions: Partial<Record<Resource, Permission[]>> = fullPermissions,
) => {
  const wrappedRouter = areasRouter.pipe(HttpRouter.catchAllCause(respondCause));
  const app = Effect.runSync(HttpRouter.toHttpApp(wrappedRouter));

  const envLayer = Layer.mergeAll(
    Layer.succeed(AreasService, service as Context.Tag.Service<typeof AreasService>),
    betterAuthLayer,
    permissionProviderLayer(permissions),
    auditLayer,
  );

  return HttpApp.toWebHandlerLayer(app as any, envLayer as any).handler;
};

const makeAreaDto = () => ({
  id: AREA_ID,
  location_id: LOCATION_ID,
  parent_id: null,
  name: 'Aisle 1',
  code: 'AISLE-1',
  description: 'Test aisle',
  is_active: true,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
});

describe('areasRouter', () => {
  describe('POST /areas', () => {
    it('returns 201 with the created area on happy path', async () => {
      const handler = makeHandler({
        create: () => Effect.succeed(makeAreaDto()),
      });

      const response = await handler(
        new Request('http://localhost/areas', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ location_id: LOCATION_ID, name: 'Aisle 1' }),
        }),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({ id: AREA_ID });
    });

    it('returns 403 when the caller lacks LOCATIONS.WRITE', async () => {
      const handler = makeHandler(
        { create: () => Effect.die('should not be called') },
        { [Resource.LOCATIONS]: [Permission.READ] },
      );

      const response = await handler(
        new Request('http://localhost/areas', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ location_id: LOCATION_ID, name: 'Aisle 1' }),
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ statusCode: 403 });
    });

    it('returns 400 when the body fails schema decode', async () => {
      const handler = makeHandler({
        create: () => Effect.die('should not be called'),
      });

      // Missing `name` + non-UUID `location_id`
      const response = await handler(
        new Request('http://localhost/areas', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ location_id: 'not-a-uuid' }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'http.parseError',
      });
    });

    it('maps AreaLocationNotFound service error to 400', async () => {
      const handler = makeHandler({
        create: () =>
          Effect.fail(
            new AreaLocationNotFound({
              locationId: LOCATION_ID,
              messageKey: 'areas.locationNotFound',
            }),
          ),
      });

      const response = await handler(
        new Request('http://localhost/areas', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ location_id: LOCATION_ID, name: 'Aisle 1' }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'areas.locationNotFound',
      });
    });
  });

  describe('GET /areas', () => {
    it('returns 200 with the area list on happy path', async () => {
      const handler = makeHandler({
        findAll: () => Effect.succeed([makeAreaDto()]),
      });

      const response = await handler(new Request('http://localhost/areas'));

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(Array.isArray(body)).toBe(true);
      expect(body[0]).toMatchObject({ id: AREA_ID });
    });

    it('returns 403 when the caller lacks LOCATIONS.READ', async () => {
      const handler = makeHandler(
        { findAll: () => Effect.die('should not be called') },
        {},
      );

      const response = await handler(new Request('http://localhost/areas'));

      expect(response.status).toBe(403);
    });
  });

  describe('GET /areas/:id', () => {
    it('returns 200 with the area when found', async () => {
      const handler = makeHandler({
        findById: () => Effect.succeed(makeAreaDto()),
      });

      const response = await handler(
        new Request(`http://localhost/areas/${AREA_ID}`),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: AREA_ID });
    });

    it('returns 404 when the service fails with AreaNotFound', async () => {
      const handler = makeHandler({
        findById: () =>
          Effect.fail(
            new AreaNotFound({
              id: AREA_ID,
              messageKey: 'areas.notFound',
            }),
          ),
      });

      const response = await handler(
        new Request(`http://localhost/areas/${AREA_ID}`),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 404,
        messageKey: 'areas.notFound',
      });
    });

    it('returns 400 when the id path param is not a UUID', async () => {
      const handler = makeHandler({
        findById: () => Effect.die('should not be called'),
      });

      const response = await handler(
        new Request('http://localhost/areas/not-a-uuid'),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'http.parseError',
      });
    });
  });

  describe('GET /areas/:id/children', () => {
    it('returns 200 with the area-with-children payload', async () => {
      const handler = makeHandler({
        findByIdWithChildren: () =>
          Effect.succeed({ ...makeAreaDto(), children: [] }),
      });

      const response = await handler(
        new Request(`http://localhost/areas/${AREA_ID}/children`),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: AREA_ID });
    });
  });

  describe('PUT /areas/:id', () => {
    it('returns 200 with the updated area on happy path', async () => {
      const handler = makeHandler({
        update: () => Effect.succeed(makeAreaDto()),
      });

      const response = await handler(
        new Request(`http://localhost/areas/${AREA_ID}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed Aisle' }),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: AREA_ID });
    });

    it('returns 403 when the caller lacks LOCATIONS.WRITE', async () => {
      const handler = makeHandler(
        { update: () => Effect.die('should not be called') },
        { [Resource.LOCATIONS]: [Permission.READ] },
      );

      const response = await handler(
        new Request(`http://localhost/areas/${AREA_ID}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed Aisle' }),
        }),
      );

      expect(response.status).toBe(403);
    });

    it('returns 400 when the body fails schema decode', async () => {
      const handler = makeHandler({
        update: () => Effect.die('should not be called'),
      });

      const response = await handler(
        new Request(`http://localhost/areas/${AREA_ID}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          // `name` must be a string; pass a number to force a decode error.
          body: JSON.stringify({ name: 42 }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'http.parseError',
      });
    });

    it('maps AreaCircularReference service error to 400', async () => {
      const handler = makeHandler({
        update: () =>
          Effect.fail(
            new AreaCircularReference({
              id: AREA_ID,
              parentId: LOCATION_ID,
              messageKey: 'areas.circularReference',
            }),
          ),
      });

      const response = await handler(
        new Request(`http://localhost/areas/${AREA_ID}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parent_id: LOCATION_ID }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'areas.circularReference',
      });
    });
  });

  describe('DELETE /areas/:id', () => {
    it('returns 200 with a delete-confirmation message on happy path', async () => {
      const handler = makeHandler({
        delete: () => Effect.void,
      });

      const response = await handler(
        new Request(`http://localhost/areas/${AREA_ID}`, { method: 'DELETE' }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        messageKey: 'areas.deleted',
      });
    });

    it('returns 403 when the caller lacks LOCATIONS.WRITE', async () => {
      const handler = makeHandler(
        { delete: () => Effect.die('should not be called') },
        { [Resource.LOCATIONS]: [Permission.READ] },
      );

      const response = await handler(
        new Request(`http://localhost/areas/${AREA_ID}`, { method: 'DELETE' }),
      );

      expect(response.status).toBe(403);
    });

    it('returns 404 when the service fails with AreaNotFound', async () => {
      const handler = makeHandler({
        delete: () =>
          Effect.fail(
            new AreaNotFound({
              id: AREA_ID,
              messageKey: 'areas.notFound',
            }),
          ),
      });

      const response = await handler(
        new Request(`http://localhost/areas/${AREA_ID}`, { method: 'DELETE' }),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 404,
        messageKey: 'areas.notFound',
      });
    });
  });
});
