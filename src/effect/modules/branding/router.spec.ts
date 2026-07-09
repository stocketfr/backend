import { type Context, Effect, Layer } from 'effect';
import { HttpApp, HttpRouter } from '@effect/platform';
import { Permission, Resource } from '@stocket/types/auth';
import { respondCause } from '../../platform/http/errors';
import { PermissionProvider } from '../../platform/auth/permission-provider';
import { makeBetterAuthTestLayer } from '../../testing/better-auth-test';
import { brandingRouter } from './router';
import { BrandingInfrastructureError } from './branding.errors';
import { BrandingService } from './service';

// Stand-in BrandingService tag; the real service requires Drizzle.
vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');

  return {
    BrandingService: Context.GenericTag('@stocket/test/BrandingService'),
    brandingLayer: Layer.empty,
  };
});

vi.mock('uuid', () => ({
  v4: () => '00000000-0000-4000-8000-000000000000',
  validate: () => true,
}));

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

const betterAuthLayer = (session: typeof fakeSession | null = fakeSession) =>
  makeBetterAuthTestLayer({
    overrides: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getSession: (async () => session) as any,
    } as any,
  });

const permissionProviderLayer = (
  permissions: Partial<Record<Resource, Permission[]>>,
) =>
  Layer.succeed(PermissionProvider, {
    getPermissionsForUser: () =>
      Effect.succeed({ roleNames: ['Test'], permissions }),
  });

const fullPerms: Partial<Record<Resource, Permission[]>> = {
  [Resource.SETTINGS]: [Permission.READ, Permission.WRITE],
};

interface HandlerOptions {
  service: Partial<Context.Tag.Service<typeof BrandingService>>;
  permissions?: Partial<Record<Resource, Permission[]>>;
  session?: typeof fakeSession | null;
}

const makeHandler = ({
  service,
  permissions = fullPerms,
  session = fakeSession,
}: HandlerOptions) => {
  const wrappedRouter = brandingRouter.pipe(
    HttpRouter.catchAllCause(respondCause),
  );
  const app = Effect.runSync(HttpRouter.toHttpApp(wrappedRouter));

  const envLayer = Layer.mergeAll(
    Layer.succeed(
      BrandingService,
      service as Context.Tag.Service<typeof BrandingService>,
    ),
    betterAuthLayer(session),
    permissionProviderLayer(permissions),
  );

  return HttpApp.toWebHandlerLayer(app as any, envLayer as any).handler;
};

const makeBrandingDto = (overrides: Record<string, unknown> = {}) => ({
  app_name: 'Stocket',
  tagline: 'Inventory management system',
  logo_url: null,
  favicon_url: null,
  primary_color: '#3b82f6',
  powered_by: {
    name: 'Stocket',
    url: 'https://github.com/maximilianpw/stocket',
  },
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('brandingRouter', () => {
  describe('GET /branding', () => {
    it('returns 200 with branding payload on happy path (unauthenticated OK)', async () => {
      // GET /branding does not call requirePermission; the public app
      // name/logo endpoint intentionally serves everyone.
      const handler = makeHandler({
        service: { get: () => Effect.succeed(makeBrandingDto()) },
        session: null,
      });

      const response = await handler(new Request('http://localhost/branding'));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        app_name: 'Stocket',
      });
    });

    it('returns 500 when the service fails with an infrastructure error', async () => {
      const handler = makeHandler({
        service: {
          get: () =>
            Effect.fail(
              new BrandingInfrastructureError({
                action: 'load branding settings',
                messageKey: 'branding.repositoryFailed',
              }),
            ),
        },
      });

      const response = await handler(new Request('http://localhost/branding'));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 500,
      });
    });
  });

  describe('PUT /branding', () => {
    it('returns 200 with updated branding on happy path', async () => {
      const handler = makeHandler({
        service: {
          update: () => Effect.succeed(makeBrandingDto({ app_name: 'New' })),
        },
      });

      const response = await handler(
        new Request('http://localhost/branding', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ app_name: 'New' }),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        app_name: 'New',
      });
    });

    it('returns 403 when the caller lacks SETTINGS.WRITE', async () => {
      const handler = makeHandler({
        service: { update: () => Effect.die('should not be called') },
        permissions: { [Resource.SETTINGS]: [Permission.READ] },
      });

      const response = await handler(
        new Request('http://localhost/branding', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ app_name: 'New' }),
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ statusCode: 403 });
    });

    it('returns 401 when the request is unauthenticated', async () => {
      const handler = makeHandler({
        service: { update: () => Effect.die('should not be called') },
        session: null,
      });

      const response = await handler(
        new Request('http://localhost/branding', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ app_name: 'New' }),
        }),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ statusCode: 401 });
    });

    it('returns 400 when the body fails schema decode', async () => {
      const handler = makeHandler({
        service: { update: () => Effect.die('should not be called') },
      });

      // `primary_color` must match /^#[\dA-Fa-f]{6}$/
      const response = await handler(
        new Request('http://localhost/branding', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ primary_color: 'not-a-hex' }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'http.parseError',
      });
    });

    it('returns 500 when the service fails with an infrastructure error', async () => {
      const handler = makeHandler({
        service: {
          update: () =>
            Effect.fail(
              new BrandingInfrastructureError({
                action: 'upsert branding settings',
                messageKey: 'branding.repositoryFailed',
              }),
            ),
        },
      });

      const response = await handler(
        new Request('http://localhost/branding', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ app_name: 'New' }),
        }),
      );

      expect(response.status).toBe(500);
    });
  });
});
