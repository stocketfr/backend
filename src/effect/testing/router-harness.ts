import { HttpApp, HttpRouter } from '@effect/platform';
import type { Permission, Resource } from '@stocket/types/auth';
import { type Context, Effect, Layer } from 'effect';
import {
  AuditLogWriter,
  type AuditWriteParams,
} from '../platform/audit';
import {
  BetterAuth,
  type BetterAuthService,
} from '../platform/better-auth';
import { respondCause } from '../platform/errors';
import { PermissionProvider } from '../platform/permission-provider';
import type { UserSession } from '../platform/auth/user-session';

export const FAKE_USER_ID = '00000000-0000-4000-a000-000000000001';

export type RouterAuditLog = (
  params: AuditWriteParams,
) => Effect.Effect<void, never, unknown>;

export interface RouterTestHarnessOptions {
  readonly router: HttpRouter.HttpRouter<unknown, unknown>;
  readonly layers: readonly Layer.Layer<never, never, never>[];
  readonly permissions?: Partial<Record<Resource, Permission[]>>;
  readonly roleNames?: readonly string[];
  readonly session?: UserSession | null;
  readonly provideBetterAuth?: boolean;
  readonly auditLog?: RouterAuditLog;
}

export interface RouterTestHarness {
  readonly handler: (request: Request) => Promise<Response>;
  readonly auditSpy: RouterAuditLog;
}

export const makeFakeSession = (userId = FAKE_USER_ID): UserSession => ({
  user: {
    id: userId,
    name: 'Test User',
    email: 'test@example.com',
    image: null,
    emailVerified: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    role: 'user',
  },
  session: {
    id: 'session-1',
    userId,
    token: 'tok',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
  },
});

export const makeRouterServiceLayer = <I, S>(
  tag: Context.Tag<I, S>,
  service: Partial<S> | Record<string, unknown>,
): Layer.Layer<never, never, never> =>
  Layer.succeed(tag, service as S) as Layer.Layer<never, never, never>;

const makePermissionProviderLayer = (
  permissions: Partial<Record<Resource, Permission[]>>,
  roleNames: readonly string[],
) =>
  Layer.succeed(PermissionProvider, {
    getPermissionsForUser: () =>
      Effect.succeed({ roleNames: [...roleNames], permissions }),
  }) as Layer.Layer<never, never, never>;

const makeAuditLayer = (auditSpy: RouterAuditLog) =>
  Layer.succeed(AuditLogWriter, { log: auditSpy }) as Layer.Layer<
    never,
    never,
    never
  >;

const makeBetterAuthLayer = (session: UserSession | null) =>
  Layer.succeed(BetterAuth, {
    api: {
      getSession: async () => session,
    } as unknown as BetterAuthService['api'],
    auth: {} as BetterAuthService['auth'],
    handler: (() => {
      throw new Error('handler not available in tests');
    }) as unknown as BetterAuthService['handler'],
  }) as Layer.Layer<never, never, never>;

export const makeRouterTestHarness = (
  opts: RouterTestHarnessOptions,
): RouterTestHarness => {
  const permissions = opts.permissions ?? {};
  const roleNames = opts.roleNames ?? ['Tester'];
  const auditSpy = opts.auditLog ?? (() => Effect.void);
  const platformLayers: Layer.Layer<never, never, never>[] = [
    makePermissionProviderLayer(permissions, roleNames),
    makeAuditLayer(auditSpy),
  ];

  if (opts.provideBetterAuth) {
    platformLayers.push(
      makeBetterAuthLayer(
        opts.session === undefined ? makeFakeSession() : opts.session,
      ),
    );
  }

  const routerWithErrorHandling = opts.router.pipe(
    HttpRouter.catchAllCause(respondCause),
  );
  const app = Effect.runSync(HttpRouter.toHttpApp(routerWithErrorHandling));

  const allLayers = [...opts.layers, ...platformLayers] as [
    Layer.Layer<never, never, never>,
    ...Layer.Layer<never, never, never>[],
  ];

  const { handler } = HttpApp.toWebHandlerLayer(
    app as never,
    Layer.mergeAll(...allLayers) as never,
  );

  return { handler, auditSpy };
};
