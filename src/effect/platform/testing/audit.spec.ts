import { HttpServerRequest } from '@effect/platform';
import { Effect, Layer } from 'effect';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { makeBetterAuthTestLayer } from '../../testing/better-auth-test';
import { DrizzleDatabase } from '../db/drizzle';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../http/request-context';
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-constants';
import { makeAuditLogWriter } from '../audit/index';
import { CurrentRequestActor, type RequestActor } from '../auth/request-actor';

const TEST_USER_ID = '00000000-0000-4000-a000-000000000001';
const TEST_ENTITY_ID = '00000000-0000-4000-b000-000000000001';
const TEST_ACTOR_TENANT_ID = '00000000-0000-4000-a000-000000000002';

const makeSession = () => ({
  user: {
    id: TEST_USER_ID,
    name: 'Audit Test User',
    email: 'audit@example.com',
    image: null,
    emailVerified: true,
    createdAt: new Date('2026-05-24T08:00:00.000Z'),
    updatedAt: new Date('2026-05-24T08:00:00.000Z'),
    role: 'user' as const,
  },
  session: {
    id: 'session-audit',
    userId: TEST_USER_ID,
    token: 'token-audit',
    createdAt: new Date('2026-05-24T08:00:00.000Z'),
    updatedAt: new Date('2026-05-24T08:00:00.000Z'),
    expiresAt: new Date('2026-06-24T08:00:00.000Z'),
    activeOrganizationId: null,
  },
});

const makeRequestContext = (
  overrides: Partial<RequestContext> = {},
): RequestContext => ({
  requestId: '00000000-0000-4000-8000-000000000099',
  path: '/api/v1/inventory',
  method: 'POST',
  ip: '203.0.113.10',
  locale: 'en',
  tenantId: DEFAULT_TENANT_ID,
  tenantName: 'Default',
  tenantSlug: 'default',
  ...overrides,
});

const makeRequestLayer = () =>
  Layer.succeed(
    HttpServerRequest.HttpServerRequest,
    HttpServerRequest.fromWeb(
      new Request('http://localhost/api/v1/inventory', {
        headers: { authorization: 'Bearer test-token' },
      }),
    ),
  );

async function waitForCall(spy: ReturnType<typeof vi.fn>) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (spy.mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for audit insert');
}

function makeDb(values: ReturnType<typeof vi.fn>) {
  return {
    insert: vi.fn(() => ({ values })),
  };
}

const runWriter = (
  db: ReturnType<typeof makeDb>,
  options: {
    readonly session?: ReturnType<typeof makeSession> | null;
    readonly requestContext?: RequestContext;
    readonly actor?: RequestActor;
    readonly getSession?: ReturnType<typeof vi.fn>;
  } = {},
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const writer = yield* makeAuditLogWriter;
      yield* writer.log({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.INVENTORY,
        entityId: TEST_ENTITY_ID,
      });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(DrizzleDatabase, db as never),
          makeBetterAuthTestLayer({
            overrides: {
              getSession:
                options.getSession ?? (async () => options.session ?? null),
            } as never,
          }),
          makeRequestLayer(),
          Layer.succeed(
            CurrentRequestContext,
            options.requestContext ?? makeRequestContext(),
          ),
          options.actor
            ? Layer.succeed(CurrentRequestActor, options.actor)
            : Layer.empty,
        ),
      ),
    ),
  );

describe('makeAuditLogWriter', () => {
  it('persists audit fields from request and session context', async () => {
    const values = vi.fn(async () => undefined);
    const db = makeDb(values);

    await runWriter(db, { session: makeSession() });
    await waitForCall(values);

    expect(values).toHaveBeenCalledWith({
      tenant_id: DEFAULT_TENANT_ID,
      user_id: TEST_USER_ID,
      action: AuditAction.CREATE,
      entity_type: AuditEntityType.INVENTORY,
      entity_id: TEST_ENTITY_ID,
      changes: null,
      ip_address: '203.0.113.10',
      user_agent: null,
    });
  });

  it('persists null user id when no session is available', async () => {
    const values = vi.fn(async () => undefined);
    const db = makeDb(values);

    await runWriter(db, { session: null });
    await waitForCall(values);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: null,
        tenant_id: DEFAULT_TENANT_ID,
      }),
    );
  });

  it('uses the verified request actor without loading the session again', async () => {
    const values = vi.fn(async () => undefined);
    const getSession = vi.fn(async () => makeSession());
    const db = makeDb(values);

    await runWriter(db, {
      getSession,
      actor: {
        userId: TEST_USER_ID,
        tenantId: TEST_ACTOR_TENANT_ID,
        tenantName: 'Actor workspace',
        tenantSlug: 'actor-workspace',
      },
    });
    await waitForCall(values);

    expect(getSession).not.toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: TEST_USER_ID,
        tenant_id: TEST_ACTOR_TENANT_ID,
      }),
    );
  });

  it('falls back to the default tenant when request context has no tenant', async () => {
    const values = vi.fn(async () => undefined);
    const db = makeDb(values);

    await runWriter(db, {
      session: makeSession(),
      requestContext: makeRequestContext({
        tenantId: undefined,
        tenantName: undefined,
        tenantSlug: undefined,
      }),
    });
    await waitForCall(values);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: DEFAULT_TENANT_ID,
      }),
    );
  });

  it('swallows database write failures', async () => {
    const values = vi.fn(async () => {
      throw new Error('insert failed');
    });
    const db = makeDb(values);

    await expect(
      runWriter(db, { session: makeSession() }),
    ).resolves.toBeUndefined();
    await waitForCall(values);
  });
});
