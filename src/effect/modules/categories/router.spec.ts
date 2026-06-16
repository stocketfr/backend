import { describe, expect, it, vi } from 'vitest';
import { type Context, Effect, Layer } from 'effect';
import { HttpApp, HttpRouter } from '@effect/platform';
import { Permission, Resource } from '@stocket/types/auth';
import { respondCause } from '../../platform/http/errors';
import { PermissionProvider } from '../../platform/auth/permission-provider';
import { AuditLogWriter } from '../../platform/audit/index';
import { makeBetterAuthTestLayer } from '../../testing/better-auth-test';
import { categoriesRouter } from './router';
import {
  CategoryCircularReference,
  CategoryNameAlreadyExists,
  CategoryNotFound,
} from './categories.errors';
import { CategoriesService } from './service';

// Stand-in CategoriesService tag; the real service requires Drizzle via its
// repository. Router tests only verify the HTTP boundary.
vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');

  return {
    CategoriesService: Context.GenericTag('@stocket/test/CategoriesService'),
    categoriesLayer: Layer.empty,
  };
});

vi.mock('uuid', () => ({
  v4: () => '00000000-0000-4000-8000-000000000000',
  validate: () => true,
}));

const CATEGORY_ID = '10000000-0000-4000-8000-000000000001';
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
  [Resource.PRODUCTS]: [Permission.READ, Permission.WRITE],
};

const makeHandler = (
  service: Partial<Context.Tag.Service<typeof CategoriesService>>,
  permissions: Partial<Record<Resource, Permission[]>> = fullPermissions,
) => {
  const wrappedRouter = categoriesRouter.pipe(
    HttpRouter.catchAllCause(respondCause),
  );
  const app = Effect.runSync(HttpRouter.toHttpApp(wrappedRouter));

  const envLayer = Layer.mergeAll(
    Layer.succeed(
      CategoriesService,
      service as Context.Tag.Service<typeof CategoriesService>,
    ),
    betterAuthLayer,
    permissionProviderLayer(permissions),
    auditLayer,
  );

  return HttpApp.toWebHandlerLayer(app as any, envLayer as any).handler;
};

const makeCategory = (overrides: Record<string, unknown> = {}) => ({
  id: CATEGORY_ID,
  tenant_id: '00000000-0000-4000-8000-000000000001',
  name: 'Electronics',
  parent_id: null,
  description: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('categoriesRouter', () => {
  describe('GET /categories', () => {
    it('returns 200 with the category tree on happy path', async () => {
      const handler = makeHandler({
        findAll: () =>
          Effect.succeed([{ ...makeCategory(), children: [] } as any]),
      });

      const response = await handler(
        new Request('http://localhost/categories'),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body[0]).toMatchObject({ id: CATEGORY_ID });
    });

    it('returns 403 when the caller lacks PRODUCTS.READ', async () => {
      const handler = makeHandler(
        { findAll: () => Effect.die('should not be called') },
        {},
      );

      const response = await handler(
        new Request('http://localhost/categories'),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ statusCode: 403 });
    });
  });

  describe('POST /categories', () => {
    it('returns 201 with the created category on happy path', async () => {
      const handler = makeHandler({
        create: () => Effect.succeed(makeCategory()),
      });

      const response = await handler(
        new Request('http://localhost/categories', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Electronics' }),
        }),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({ id: CATEGORY_ID });
    });

    it('returns 403 when the caller lacks PRODUCTS.WRITE', async () => {
      const handler = makeHandler(
        { create: () => Effect.die('should not be called') },
        { [Resource.PRODUCTS]: [Permission.READ] },
      );

      const response = await handler(
        new Request('http://localhost/categories', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Electronics' }),
        }),
      );

      expect(response.status).toBe(403);
    });

    it('returns 400 when the body fails schema decode', async () => {
      const handler = makeHandler({
        create: () => Effect.die('should not be called'),
      });

      // `name` is required and must have minLength >= 1.
      const response = await handler(
        new Request('http://localhost/categories', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: '' }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'http.parseError',
      });
    });

    it('maps CategoryNameAlreadyExists service error to 400', async () => {
      const handler = makeHandler({
        create: () =>
          Effect.fail(
            new CategoryNameAlreadyExists({
              name: 'Electronics',
              parentId: null,
              messageKey: 'categories.nameAlreadyExists',
            }),
          ),
      });

      const response = await handler(
        new Request('http://localhost/categories', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Electronics' }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'categories.nameAlreadyExists',
      });
    });
  });

  describe('PUT /categories/:id', () => {
    it('returns 200 with the updated category on happy path', async () => {
      const handler = makeHandler({
        update: () => Effect.succeed(makeCategory({ name: 'Renamed' })),
      });

      const response = await handler(
        new Request(`http://localhost/categories/${CATEGORY_ID}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed' }),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: CATEGORY_ID,
        name: 'Renamed',
      });
    });

    it('returns 403 when the caller lacks PRODUCTS.WRITE', async () => {
      const handler = makeHandler(
        { update: () => Effect.die('should not be called') },
        { [Resource.PRODUCTS]: [Permission.READ] },
      );

      const response = await handler(
        new Request(`http://localhost/categories/${CATEGORY_ID}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed' }),
        }),
      );

      expect(response.status).toBe(403);
    });

    it('returns 400 when the id path param is not a UUID', async () => {
      const handler = makeHandler({
        update: () => Effect.die('should not be called'),
      });

      const response = await handler(
        new Request('http://localhost/categories/not-a-uuid', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed' }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'http.parseError',
      });
    });

    it('maps CategoryCircularReference service error to 400', async () => {
      const handler = makeHandler({
        update: () =>
          Effect.fail(
            new CategoryCircularReference({
              id: CATEGORY_ID,
              parentId: CATEGORY_ID,
              messageKey: 'categories.circularReference',
            }),
          ),
      });

      const response = await handler(
        new Request(`http://localhost/categories/${CATEGORY_ID}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parent_id: CATEGORY_ID }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'categories.circularReference',
      });
    });
  });

  describe('DELETE /categories/:id', () => {
    it('returns 200 with a delete-confirmation message on happy path', async () => {
      const handler = makeHandler({
        delete: () => Effect.void,
      });

      const response = await handler(
        new Request(`http://localhost/categories/${CATEGORY_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        messageKey: 'categories.deleted',
      });
    });

    it('returns 403 when the caller lacks PRODUCTS.WRITE', async () => {
      const handler = makeHandler(
        { delete: () => Effect.die('should not be called') },
        { [Resource.PRODUCTS]: [Permission.READ] },
      );

      const response = await handler(
        new Request(`http://localhost/categories/${CATEGORY_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(403);
    });

    it('returns 404 when the service fails with CategoryNotFound', async () => {
      const handler = makeHandler({
        delete: () =>
          Effect.fail(
            new CategoryNotFound({
              id: CATEGORY_ID,
              messageKey: 'categories.notFound',
            }),
          ),
      });

      const response = await handler(
        new Request(`http://localhost/categories/${CATEGORY_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 404,
        messageKey: 'categories.notFound',
      });
    });
  });
});
